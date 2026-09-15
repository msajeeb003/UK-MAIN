"""Asynchronous processing (BRD S4 / ART-330): a job per document, statuses
the UI can poll, safe failure per file, one retry on transient errors,
idempotent re-runs that keep broker edits, and the derived project status."""

import threading
import time

import pytest

from app.api import jobs
from app.core.errors import TransientUpstreamError, UpstreamServiceError
from app.models.schemas import QuoteExtraction, SourcedValue
from app.services import pipeline as pipeline_mod

PID = "pipe-p1"


def _project(client, pid: str = PID) -> None:
    assert client.put(f"/projects/{pid}", json={"client_name": "Pipeline Test Ltd", "policy_type": "Whole Turnover",
                                                 "insurers_approached": ["allianz", "qbe"]}).status_code in (200, 201)


def _wait(client, pid: str, doc_id: str, timeout: float = 25.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/projects/{pid}/documents/{doc_id}").json()
        if body["status"] in ("ready", "unreadable"):
            return body
        time.sleep(0.05)
    pytest.fail(f"document {doc_id} did not finish")


_FIELDS = ("insurer", "annual_turnover", "premium_rate", "estimated_annual_premium_exc_ipt",
           "minimum_annual_premium", "credit_limit_charges", "indemnity", "excess", "excess_type",
           "max_annual_liability", "discretionary_limit", "max_terms_of_payment",
           "max_extension_period")


def _sv(value: str | None, page: int | None = 1) -> SourcedValue:
    return SourcedValue(value=value, page=page if value else None, confidence="high" if value else None)


def _extraction_for(insurer: str | None, **overrides) -> QuoteExtraction:
    """A complete quote extraction (every standard field present, most null)."""
    base = {name: _sv(None) for name in _FIELDS}
    base.update(
        document_type="insurer_quote",
        insurer=_sv(insurer),
        annual_turnover=_sv("GBP 12,000,000"),
        premium_rate=_sv("0.055%"),
        estimated_annual_premium_exc_ipt=_sv("GBP 6,600"),
        indemnity=_sv("90%"),
        excess=_sv("GBP 5,000", 2),
        max_annual_liability=_sv("GBP 1,800,000", 2),
        buyer_credit_limits=[],
    )
    base.update(overrides)
    return QuoteExtraction(**base)


@pytest.fixture(autouse=True)
def _fast_retry(monkeypatch):
    monkeypatch.setattr(jobs, "RETRY_DELAY_SECONDS", 0.01)


def _upload(client, pid: str, files, slot: str = "quote") -> list[dict]:
    res = client.post(f"/projects/{pid}/documents", files=files, data={"slot": slot})
    assert res.status_code == 202, res.text
    return res.json()["documents"]


# ── Acceptance 1: three files, one corrupt ──────────────────────────────────

def test_three_uploads_one_corrupt(client, digital_pdf, monkeypatch):
    """Two reach `ready`, one `unreadable` with a reason, the project becomes
    `ready`; while a job runs the project reports `processing`."""
    gate = threading.Event()
    calls: list[str] = []

    def slow_extract(text: str) -> QuoteExtraction:
        calls.append(text[:20])
        gate.wait(10)                                        # hold the first run
        name = "QBE UK LIMITED" if "Beta" in text else "Allianz Trade"
        return _extraction_for(name)

    monkeypatch.setattr(pipeline_mod, "extract_quote_fields", slow_extract)
    _project(client)
    from tests.conftest import make_pdf
    alpha = make_pdf([["Alpha quote"] * 20])
    beta = make_pdf([["Beta quote"] * 20])
    recs = _upload(client, PID, [
        ("files", ("alpha.pdf", alpha, "application/pdf")),
        ("files", ("beta.pdf", beta, "application/pdf")),
        ("files", ("corrupt.pdf", b"%PDF-1.4 garbage", "application/pdf")),
    ])
    assert [r["status"] for r in recs] == ["uploaded", "uploaded", "uploaded"]
    assert client.get(f"/projects/{PID}").json()["processing_status"] == "processing"
    listed = client.get(f"/projects/{PID}/documents").json()
    assert listed["processing_status"] == "processing"
    # The corrupt file fails on its own, without waiting for the others.
    bad = _wait(client, PID, recs[2]["id"])
    assert bad["status"] == "unreadable" and bad["stage"] == "failed"
    assert "PDF" in bad["error"] and bad["attempts"] == 1
    assert [t["step"] for t in bad["timings"]] == ["text_extraction"] and bad["timings"][0]["ok"] is False
    assert client.get(f"/projects/{PID}").json()["processing_status"] == "processing"

    gate.set()
    good = _wait(client, PID, recs[0]["id"])
    assert good["status"] == "ready" and good["page_count"] == 1 and good["error"] is None
    steps = [t["step"] for t in good["timings"]]
    assert steps == ["text_extraction", "extraction", "identification", "terminology_mapping",
                     "verification", "wording_rules", "persist"]
    assert all(t["ok"] and t["ms"] >= 0 for t in good["timings"])
    assert "insurer=Allianz Trade" in good["timings"][1]["detail"]
    assert _wait(client, PID, recs[1]["id"])["status"] == "ready"

    project = client.get(f"/projects/{PID}").json()
    assert project["processing_status"] == "ready"
    assert project["documents"] == {"processing": 0, "ready": 2, "unreadable": 1}

    # Persisted: two columns, one per insurer; the cards reflect each outcome.
    state = project["state"]
    names = sorted(c["name"] for c in state["columns"])          # completion order is not fixed
    assert names == ["Allianz", "QBE"]
    cols = {c["docId"]: c for c in state["columns"]}
    assert cols[recs[0]["id"]]["matched"] == "Allianz" and cols[recs[0]["id"]]["debt"] == "Included"
    excess = cols[recs[0]["id"]]["data"]["excess"]
    assert excess["value"] == "GBP 5,000" and excess["orig"] == "GBP 5,000"
    # The fake PDF does not contain the figure, so verification flagged it.
    assert excess["conf"] == "uncertain" and excess["page"] is None
    cards = {f["docId"]: f for f in state["files"]}
    assert cards[recs[0]["id"]]["status"] == "extracted" and cards[recs[0]["id"]]["colId"] == cols[recs[0]["id"]]["id"]
    assert cards[recs[2]["id"]]["status"] == "error" and "PDF" in cards[recs[2]["id"]]["meta"]
    assert cards[recs[2]["id"]]["jobId"] is None
    assert state["confirmed"] == {} and state["reviewed"] is False
    client.delete(f"/projects/{PID}")


# ── Hard failures ───────────────────────────────────────────────────────────

def test_hard_failures_are_unreadable_with_a_reason(client, digital_pdf, sparse_pdf, monkeypatch):
    monkeypatch.setattr(pipeline_mod, "extract_quote_fields", lambda text: _extraction_for(None))
    monkeypatch.setattr(pipeline_mod, "_scanned_engine", lambda override: "docling")
    monkeypatch.setattr(pipeline_mod, "extract_pages_docling", lambda data: [])
    _project(client)
    recs = _upload(client, PID, [
        ("files", ("noinsurer.pdf", digital_pdf, "application/pdf")),
        ("files", ("scan.pdf", sparse_pdf, "application/pdf")),
    ])
    no_insurer = _wait(client, PID, recs[0]["id"])
    assert no_insurer["status"] == "unreadable" and "insurer" in no_insurer["error"].lower()
    assert [t["ok"] for t in no_insurer["timings"]] == [True, True, False]
    zero_text = _wait(client, PID, recs[1]["id"])
    assert zero_text["status"] == "unreadable" and "No text" in zero_text["error"]
    state = client.get(f"/projects/{PID}").json()["state"]
    assert state.get("columns", []) == []                                  # nothing half-applied
    assert {f["status"] for f in state["files"]} == {"error"}
    client.delete(f"/projects/{PID}")


# ── Retry once on transient errors ──────────────────────────────────────────

def test_transient_error_is_retried_once(client, digital_pdf, monkeypatch):
    attempts: list[int] = []

    def flaky(text: str) -> QuoteExtraction:
        attempts.append(1)
        if len(attempts) == 1:
            raise TransientUpstreamError("Could not reach the Claude API (timeout). Try again.")
        return _extraction_for("Allianz Trade")

    monkeypatch.setattr(pipeline_mod, "extract_quote_fields", flaky)
    _project(client)
    rec = _upload(client, PID, [("files", ("q.pdf", digital_pdf, "application/pdf"))])[0]
    done = _wait(client, PID, rec["id"])
    assert done["status"] == "ready" and done["attempts"] == 2 and len(attempts) == 2

    attempts.clear()

    def always_down(text: str) -> QuoteExtraction:
        attempts.append(1)
        raise TransientUpstreamError("Could not reach the Claude API (timeout). Try again.")

    monkeypatch.setattr(pipeline_mod, "extract_quote_fields", always_down)
    rec = _upload(client, PID, [("files", ("down.pdf", digital_pdf, "application/pdf"))])[0]
    done = _wait(client, PID, rec["id"])
    assert done["status"] == "unreadable" and done["attempts"] == 2 and len(attempts) == 2
    assert "Claude API" in done["error"]

    attempts.clear()

    def hard(text: str) -> QuoteExtraction:
        attempts.append(1)
        raise UpstreamServiceError("The AI model declined to process this document.")

    monkeypatch.setattr(pipeline_mod, "extract_quote_fields", hard)
    rec = _upload(client, PID, [("files", ("declined.pdf", digital_pdf, "application/pdf"))])[0]
    done = _wait(client, PID, rec["id"])
    assert done["status"] == "unreadable" and done["attempts"] == 1 and len(attempts) == 1   # no retry
    client.delete(f"/projects/{PID}")


# ── Acceptance 2 + 3: re-upload / re-run only that document, edits survive ──

def test_reupload_reruns_only_that_document_and_keeps_edits(client, digital_pdf, monkeypatch):
    values = {"excess": "GBP 5,000"}
    monkeypatch.setattr(pipeline_mod, "extract_quote_fields",
                        lambda text: _extraction_for("Allianz Trade" if "Alpha" in text else "QBE UK LIMITED",
                                                     excess=SourcedValue(value=values["excess"], page=2, confidence="high")))
    _project(client)
    from tests.conftest import make_pdf
    alpha = make_pdf([["Alpha quote"] * 20])
    beta = make_pdf([["Beta quote"] * 20])
    recs = _upload(client, PID, [("files", ("alpha.pdf", alpha, "application/pdf")),
                                 ("files", ("beta.pdf", beta, "application/pdf"))])
    a, b = recs
    _wait(client, PID, a["id"])
    b_done = _wait(client, PID, b["id"])

    grid = client.get(f"/projects/{PID}/grid").json()
    col_a = next(c for c in grid["columns"] if c["name"] == "Allianz")
    col_b = next(c for c in grid["columns"] if c["name"] == "QBE")
    # The broker edits a cell, overrides a set field and types a waiting period.
    client.patch(f"/projects/{PID}/grid/columns/{col_a['id']}/cells/excess", json={"value": "GBP 7,500"})
    client.put(f"/projects/{PID}/grid/columns/{col_a['id']}/set-fields/type", json={"value": "Top-Up"})
    client.patch(f"/projects/{PID}/grid/columns/{col_a['id']}/cells/waiting_period", json={"value": "30 days"})
    client.put(f"/projects/{PID}/grid/confirmations/excess", json={"confirmed": True})

    # Re-upload a corrected alpha.pdf: the AI now reads a different excess.
    values["excess"] = "GBP 6,000"
    alpha2 = make_pdf([["Alpha quote corrected"] * 20])
    new = _upload(client, PID, [("files", ("alpha.pdf", alpha2, "application/pdf"))])[0]
    assert new["id"] != a["id"]
    assert client.get(f"/projects/{PID}/documents/{a['id']}").status_code == 404      # superseded
    assert client.get(f"/projects/{PID}/documents/{b['id']}").json()["updated_at"] == b_done["updated_at"]
    done = _wait(client, PID, new["id"])
    assert done["status"] == "ready"
    assert client.get(f"/projects/{PID}/documents/{b['id']}").json()["updated_at"] == b_done["updated_at"]  # untouched

    grid = client.get(f"/projects/{PID}/grid").json()
    assert [c["id"] for c in grid["columns"]] == [col_a["id"], col_b["id"]]           # same columns, same ids
    cell = next(c for c in grid["columns"] if c["id"] == col_a["id"])["cells"]
    assert cell["excess"]["value"] == "GBP 7,500" and cell["excess"]["orig"] == "GBP 6,000"   # edit kept, baseline refreshed
    assert cell["excess"]["provenance"] == "edited"
    assert cell["type"]["value"] == "Top-Up" and cell["type"]["source"] == "override"
    assert cell["waiting_period"]["value"] == "30 days"
    assert cell["indemnity"]["value"] == "90%" and cell["indemnity"]["provenance"] == "extracted"
    assert grid["confirmations"]["excess"]["confirmed"] is False                       # comparison changed
    state = client.get(f"/projects/{PID}").json()["state"]
    col = next(c for c in state["columns"] if c["id"] == col_a["id"])
    assert col["docId"] == new["id"] and col["fileName"] == "alpha.pdf"
    assert [f["docId"] for f in state["files"] if f["name"] == "alpha.pdf"] == [new["id"]]   # one card

    # Explicit re-run of the same stored file: only that record runs again.
    values["excess"] = "GBP 6,500"
    res = client.post(f"/projects/{PID}/documents/{new['id']}/rerun")
    assert res.status_code == 202 and res.json()["status"] == "uploaded"
    done = _wait(client, PID, new["id"])
    assert done["status"] == "ready" and done["attempts"] == 1
    cell = next(c for c in client.get(f"/projects/{PID}/grid").json()["columns"] if c["id"] == col_a["id"])["cells"]
    assert cell["excess"]["value"] == "GBP 7,500" and cell["excess"]["orig"] == "GBP 6,500"
    assert client.get(f"/projects/{PID}/documents/{b['id']}").json()["updated_at"] == b_done["updated_at"]
    assert client.post(f"/projects/{PID}/documents/nope/rerun").status_code == 404
    entries = client.get("/audit").json()["entries"]
    assert any(e["action"] == "document.rerun" and e["target"] == new["id"] for e in entries)
    client.delete(f"/projects/{PID}")


def test_limits_schedule_keeps_typed_offers_on_rerun(client, limits_xlsx, digital_pdf, monkeypatch):
    from app.models.schemas import BuyerCreditLimit

    def extract(text: str) -> QuoteExtraction:
        if "Alpha" in text:
            return _extraction_for("Allianz Trade")
        return _extraction_for(
            "Allianz Trade", document_type="credit_limit_schedule",
            buyer_credit_limits=[BuyerCreditLimit(buyer_name="Example Ltd", company_number="01234567",
                                                  limit_required="GBP 250,000", limit_offered="GBP 200,000", page=1)],
        )

    monkeypatch.setattr(pipeline_mod, "extract_quote_fields", extract)
    _project(client)
    from tests.conftest import make_pdf
    quote = _upload(client, PID, [("files", ("alpha.pdf", make_pdf([["Alpha quote"] * 20]), "application/pdf"))])[0]
    _wait(client, PID, quote["id"])
    sched = _upload(client, PID, [("files", ("limits.xlsx", limits_xlsx,
                                             "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
                    slot="limits")[0]
    _wait(client, PID, sched["id"])
    limits = client.get(f"/projects/{PID}/limits").json()
    col_id = limits["columns"][0]["id"]
    row = next(r for r in limits["rows"] if r["buyer"]["value"] == "Example Ltd")
    assert row["offers"][col_id]["value"] == "GBP 200,000"
    # The broker corrects the offer, then the schedule is re-run.
    client.put(f"/projects/{PID}/limits/rows/{row['id']}/offers/{col_id}", json={"value": "175000"})
    assert client.post(f"/projects/{PID}/documents/{sched['id']}/rerun").status_code == 202
    _wait(client, PID, sched["id"])
    limits = client.get(f"/projects/{PID}/limits").json()
    row = next(r for r in limits["rows"] if r["buyer"]["value"] == "Example Ltd")
    assert row["offers"][col_id]["value"] == "£175,000" and row["offers"][col_id]["provenance"] == "edited"
    client.delete(f"/projects/{PID}")
