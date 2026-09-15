"""Document uploads (BRD S4 / 2.9): multi-file upload into a slot, per-file
records with processing status, listing, source page, removal, erasure."""

import time

import pytest

from app.core.config import get_settings
from app.services import pipeline as pipeline_mod


def _project(client, pid: str) -> None:
    assert client.put(f"/projects/{pid}", json={"client_name": "Doc Test Ltd"}).status_code in (200, 201)


def _wait_doc(client, pid: str, doc_id: str, timeout: float = 20.0) -> dict:
    """Poll the record until the worker thread has finished with it."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        res = client.get(f"/projects/{pid}/documents/{doc_id}")
        assert res.status_code == 200
        body = res.json()
        if body["status"] in ("ready", "unreadable"):
            return body
        time.sleep(0.05)
    pytest.fail(f"document {doc_id} did not finish in {timeout}s")


def _docs_dir(pid: str):
    return get_settings().data_path / "projects" / pid / "docs"


def test_multi_file_upload_returns_a_record_per_file(client, digital_pdf, sample_extraction, monkeypatch):
    monkeypatch.setattr(pipeline_mod, "extract_quote_fields", lambda text: sample_extraction)
    _project(client, "doc-p1")

    res = client.post(
        "/projects/doc-p1/documents",
        files=[
            ("files", ("a.pdf", digital_pdf, "application/pdf")),
            ("files", ("b.pdf", digital_pdf, "application/pdf")),
            ("files", ("notes.txt", b"hello", "text/plain")),          # rejected up front
        ],
        data={"slot": "quote"},
    )
    assert res.status_code == 202, res.text
    recs = res.json()["documents"]
    assert [r["filename"] for r in recs] == ["a.pdf", "b.pdf", "notes.txt"]

    first = recs[0]
    assert first["status"] in ("uploaded", "processing")
    assert first["slot"] == "quote" and first["job_id"]
    assert first["storage_backend"] == "local" and first["size_bytes"] == len(digital_pdf)
    assert first["content_type"] == "application/pdf" and first["error"] is None
    assert first["uploaded_by"] and first["uploaded_at"] and first["processed_at"] is None
    # The object is in the store under the project's docs folder.
    assert any(f.name.startswith(first["id"]) for f in _docs_dir("doc-p1").iterdir())

    rejected = recs[2]
    assert rejected["status"] == "unreadable" and rejected["stage"] == "rejected"
    assert rejected["job_id"] is None and rejected["size_bytes"] == 0
    assert "PDF" in rejected["error"] and rejected["processed_at"]

    # The worker moves the queued records to complete.
    done = _wait_doc(client, "doc-p1", first["id"])
    assert done["status"] == "ready" and done["stage"] == "done"
    assert done["page_count"] == 2 and done["processed_at"] and done["error"] is None
    assert _wait_doc(client, "doc-p1", recs[1]["id"])["status"] == "ready"

    # The extraction result names the same record (S5 source links).
    job = client.get(f"/extract-jobs/{first['job_id']}").json()
    assert job["status"] == "done" and job["result"]["meta"]["document_id"] == first["id"]
    entries = client.get("/audit").json()["entries"]
    assert any(e["action"] == "document.upload" and e["target"] == first["id"] for e in entries)

    # Listing and filters.
    listed = client.get("/projects/doc-p1/documents").json()["documents"]
    assert [d["id"] for d in listed] == [r["id"] for r in recs]
    failed = client.get("/projects/doc-p1/documents", params={"status": "unreadable"}).json()["documents"]
    assert [d["id"] for d in failed] == [rejected["id"]]
    assert client.get("/projects/doc-p1/documents", params={"slot": "limits"}).json()["documents"] == []
    assert client.get("/projects/doc-p1/documents", params={"slot": "nope"}).status_code == 422

    # Source page served from the store.
    page = client.get(f"/documents/{first['id']}/page/1")
    assert page.status_code == 200 and page.headers["content-type"] == "image/png"
    assert page.content[0] == 137 and page.content[1:4] == b"PNG"
    assert page.headers["x-page-count"] == "2"
    assert client.get(f"/documents/{first['id']}/page/3").status_code == 404

    # Removing a record removes its object too.
    assert client.delete(f"/projects/doc-p1/documents/{first['id']}").status_code == 204
    assert not any(f.name.startswith(first["id"]) for f in _docs_dir("doc-p1").iterdir())
    assert client.get(f"/projects/doc-p1/documents/{first['id']}").status_code == 404
    assert client.get(f"/documents/{first['id']}/page/1").status_code == 404
    assert client.delete(f"/projects/doc-p1/documents/{first['id']}").status_code == 404
    assert client.delete(f"/projects/other/documents/{recs[1]['id']}").status_code == 404

    # Erasing the project takes the remaining objects with it.
    assert client.delete("/projects/doc-p1").status_code == 204
    assert not _docs_dir("doc-p1").exists()


def test_pipeline_failure_marks_the_record_failed(client):
    _project(client, "doc-p2")
    res = client.post(
        "/projects/doc-p2/documents",
        files=[("files", ("broken.pdf", b"not a pdf", "application/pdf"))],
        data={"slot": "limits"},
    )
    assert res.status_code == 202
    rec = res.json()["documents"][0]
    assert rec["status"] in ("uploaded", "processing") and rec["slot"] == "limits"
    done = _wait_doc(client, "doc-p2", rec["id"])
    assert done["status"] == "unreadable" and done["stage"] == "failed"
    assert done["error"] and done["processed_at"]
    # The object stays (the broker can inspect it) until the record is removed.
    assert any(f.name.startswith(rec["id"]) for f in _docs_dir("doc-p2").iterdir())
    client.delete("/projects/doc-p2")


def test_upload_validation(client, digital_pdf):
    pdf = ("files", ("q.pdf", digital_pdf, "application/pdf"))
    assert client.post("/projects/none/documents", files=[pdf], data={"slot": "quote"}).status_code == 404
    _project(client, "doc-p3")
    assert client.post("/projects/doc-p3/documents", files=[pdf], data={"slot": "other"}).status_code == 422
    assert client.post("/projects/doc-p3/documents", data={"slot": "quote"}).status_code == 422
    too_many = [("files", (f"q{i}.pdf", digital_pdf, "application/pdf")) for i in range(21)]
    assert client.post("/projects/doc-p3/documents", files=too_many, data={"slot": "quote"}).status_code == 422
    assert client.get("/projects/none/documents").status_code == 404
    client.delete("/projects/doc-p3")


def test_sync_extract_quote_still_retains_through_the_store(client, digital_pdf, sample_extraction, monkeypatch):
    """The single-file paths keep working and now produce the same record."""
    monkeypatch.setattr(pipeline_mod, "extract_quote_fields", lambda text: sample_extraction)
    res = client.post("/extract-quote",
                      files={"file": ("quote.pdf", digital_pdf, "application/pdf")},
                      data={"project_id": "doc-p4", "doc_kind": "expiring"})
    assert res.status_code == 200
    doc_id = res.json()["meta"]["document_id"]
    rec = client.get(f"/projects/doc-p4/documents/{doc_id}").json()
    assert rec["status"] == "ready" and rec["slot"] == "expiring" and rec["page_count"] == 2
    # The project row was created as a draft so the record has a parent.
    assert client.get("/projects/doc-p4").json()["status"] == "draft"
    client.delete("/projects/doc-p4")


def test_document_endpoints_require_sign_in(anon_client, digital_pdf):
    assert anon_client.post("/projects/x/documents",
                            files=[("files", ("q.pdf", digital_pdf, "application/pdf"))],
                            data={"slot": "quote"}).status_code == 401
    assert anon_client.get("/projects/x/documents").status_code == 401
    assert anon_client.get("/projects/x/documents/y").status_code == 401
    assert anon_client.delete("/projects/x/documents/y").status_code == 401
    assert anon_client.get("/documents/y/page/1").status_code == 401
