"""Background extraction jobs (S4 status polling): queue, poll, result."""

import time

import pytest

from app.services import pipeline as pipeline_mod


def _wait(client, job_id, timeout=20.0):
    """Poll until the job leaves queued/processing (the worker is a thread)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        res = client.get(f"/extract-jobs/{job_id}")
        assert res.status_code == 200
        body = res.json()
        if body["status"] in ("done", "error"):
            return body
        time.sleep(0.05)
    pytest.fail(f"job {job_id} did not finish in {timeout}s")


def test_job_queues_then_returns_the_extraction(client, digital_pdf, sample_extraction, monkeypatch):
    monkeypatch.setattr(pipeline_mod, "extract_quote_fields", lambda text: sample_extraction)
    res = client.post(
        "/extract-jobs",
        files={"file": ("quote.pdf", digital_pdf, "application/pdf")},
        data={"project_id": "job-proj-1", "doc_kind": "quote"},
    )
    assert res.status_code == 202
    job = res.json()
    assert job["status"] in ("queued", "processing")
    assert job["filename"] == "quote.pdf"
    assert job["kind"] == "quote"
    assert job["result"] is None

    done = _wait(client, job["job_id"])
    assert done["status"] == "done"
    assert done["stage"] == "done"
    assert done["error"] is None
    # The result is the same contract as /extract-quote.
    body = done["result"]
    assert body["meta"]["page_count"] == 2
    assert body["data"]["insurer"]["value"] == "ACME Credit Insurance plc"
    assert body["set_fields"]["debt_collection_support"]["value"] == "Outsourced"
    # The document was retained against the project, as with the sync route.
    assert body["meta"]["document_id"]
    audit = client.get("/audit").json()["entries"]
    assert any(e["action"] == "document.upload" and e["target"] == body["meta"]["document_id"]
               for e in audit)


def test_job_reports_pipeline_errors_as_error_status(client, monkeypatch):
    res = client.post(
        "/extract-jobs", files={"file": ("bad.pdf", b"not a pdf", "application/pdf")}
    )
    assert res.status_code == 202
    done = _wait(client, res.json()["job_id"])
    assert done["status"] == "error"
    assert done["error_status"] in (400, 415, 422)
    assert done["error"]            # client-safe message, non-empty
    assert done["result"] is None


def test_upload_validation_happens_before_queueing(client):
    res = client.post("/extract-jobs", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert res.status_code == 415
    res = client.post("/extract-jobs", files={"file": ("empty.pdf", b"", "application/pdf")})
    assert res.status_code == 400


def test_unknown_job_is_404(client):
    assert client.get("/extract-jobs/nope").status_code == 404


def test_jobs_require_a_session(anon_client, digital_pdf):
    res = anon_client.post(
        "/extract-jobs", files={"file": ("q.pdf", digital_pdf, "application/pdf")}
    )
    assert res.status_code == 401
    assert anon_client.get("/extract-jobs/abc").status_code == 401
