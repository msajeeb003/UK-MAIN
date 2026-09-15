"""
Document uploads (BRD S4 / 2.9): multi-file upload into a slot, per-file
processing records, listing, removal, and the rendered source page.

`POST /projects/{id}/documents` takes any number of files for ONE slot
(`quote` | `expiring` | `limits`), stores each in the object store
(Supabase Storage in production), creates a `documents` record per file,
adds its upload card to the project and queues the extraction. It returns
202 with the records — status `uploaded` for queued files, `unreadable`
(with the reason) for files rejected up front — so the client has an id to
poll from the first response. A job per document runs the pipeline
(app/api/jobs.py): `processing` → `ready` | `unreadable`; one bad file
never blocks the others. Re-uploading a file of the same name into the
same slot replaces its record and re-runs only that document;
`POST …/{doc}/rerun` re-runs a stored one (broker edits survive).
"""

import logging
import threading
from collections import OrderedDict
from datetime import datetime
from typing import Annotated, Literal

import pymupdf
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import jobs
from app.api.routes import validate_upload
from app.core import audit, db
from app.core.auth import require_user
from app.db.engine import get_session, session_scope
from app.services import apply
from app.services import documents as docs
from app.services import projects as projects_repo
from app.services.pipeline import EngineOverride
from app.storage import StorageError, get_store

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_user)])

Slot = Literal["quote", "expiring", "limits"]
DocumentStatus = Literal["uploaded", "processing", "ready", "unreadable"]
MAX_FILES_PER_REQUEST = 20

User = Annotated[dict, Depends(require_user)]
Db = Annotated[Session, Depends(get_session)]


class DocumentOut(BaseModel):
    id: str
    project_id: str
    slot: Slot
    filename: str
    content_type: str
    size_bytes: int
    status: DocumentStatus
    stage: str
    error: str | None
    page_count: int
    attempts: int
    timings: list[dict]
    job_id: str | None
    storage_backend: str
    uploaded_by: str
    uploaded_at: datetime
    updated_at: datetime
    processed_at: datetime | None


class DocumentBatchOut(BaseModel):
    documents: list[DocumentOut]
    processing_status: Literal["processing", "ready"] = "ready"


def _require_project(session: Session, project_id: str) -> None:
    if projects_repo.get(session, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found.")


# ── Upload ─────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/documents", response_model=DocumentBatchOut,
             status_code=status.HTTP_202_ACCEPTED)
async def upload_documents(
    project_id: str,
    session: Db,
    user: User,
    files: Annotated[list[UploadFile], File(description="One or more PDF / Excel files for the slot")],
    slot: Annotated[Slot, Form(description="Which upload slot the files belong to")] = "quote",
    engine: Annotated[EngineOverride, Query()] = "auto",
) -> dict:
    """Store every file, create its record and queue its extraction. A file
    that fails validation still gets a record (status `failed`, with the
    reason) so the caller sees one outcome per file it sent."""
    _require_project(session, project_id)
    if not files:
        raise HTTPException(status_code=422, detail="No files were sent.")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(status_code=422,
                            detail=f"At most {MAX_FILES_PER_REQUEST} files per request.")
    store = get_store()
    actor = user["email"]
    records: list[dict] = []
    entries: list[dict] = []
    to_start: list[tuple] = []

    for upload in files:
        doc_id = docs.new_id()
        given_name = upload.filename or "upload"
        try:
            filename, file_kind, data = await validate_upload(upload)
        except HTTPException as exc:
            rec = docs.create(
                session, document_id=doc_id, project_id=project_id, slot=slot,
                filename=given_name, content_type=upload.content_type or "application/octet-stream",
                size_bytes=0, storage_backend=store.backend, storage_key="", actor=actor,
                status="unreadable", stage="rejected", error=str(exc.detail),
            )
            session.commit()
            records.append(docs.serialize(rec))
            entries.append(apply.file_entry(doc_id, given_name, slot, status="error",
                                            meta=f"{_kind_label(slot)} · {exc.detail}", job_id=None))
            continue

        # A re-upload of the same file (a corrected version) replaces the
        # earlier record and re-runs only this document.
        prior = docs.find_by_name(session, project_id, slot, filename)
        if prior is not None:
            old_key = docs.delete(session, prior)
            session.commit()
            _forget_bytes(prior.id)
            if old_key:
                try:
                    store.delete(old_key)
                except StorageError as exc:
                    logger.warning("Superseded object %s left behind: %s", old_key, exc)

        key = docs.object_key(project_id, doc_id, filename)
        content_type = docs.content_type_for(filename)
        try:
            store.put(key, data, content_type)
        except StorageError as exc:
            logger.error("Storing %s for project %s failed: %s", filename, project_id, exc)
            reason = "Could not store the file — try again."
            rec = docs.create(
                session, document_id=doc_id, project_id=project_id, slot=slot,
                filename=filename, content_type=content_type, size_bytes=len(data),
                storage_backend=store.backend, storage_key="", actor=actor,
                status="unreadable", stage="storage", error=reason,
            )
            session.commit()
            records.append(docs.serialize(rec))
            entries.append(apply.file_entry(doc_id, filename, slot, status="error",
                                            meta=f"{_kind_label(slot)} · {reason}", job_id=None))
            continue

        # The job row exists before the record is committed, so the record
        # carries its job id from the first response and no status update
        # from the worker can race the assignment.
        job_id = jobs.create_job(project_id=project_id, doc_kind=slot, filename=filename, actor=actor)
        rec = docs.create(
            session, document_id=doc_id, project_id=project_id, slot=slot,
            filename=filename, content_type=content_type, size_bytes=len(data),
            storage_backend=store.backend, storage_key=key, actor=actor,
            status="uploaded", stage="queued", job_id=job_id,
        )
        session.commit()
        records.append(docs.serialize(rec))
        entries.append(apply.file_entry(doc_id, filename, slot, status="queued",
                                        meta=f"{_kind_label(slot)} · queued · waiting for a slot", job_id=job_id))
        to_start.append((job_id, data, filename, file_kind, doc_id))

    # The upload cards go into the project before any job can finish, so
    # the worker's status updates always find them.
    _add_entries(session, project_id, entries, actor)
    for job_id, data, filename, file_kind, doc_id in to_start:
        jobs.start_job(job_id, data, filename, file_kind, engine, project_id=project_id,
                       doc_kind=slot, actor=actor, document_id=doc_id)

    summary = docs.processing_summary(session, [project_id]).get(project_id, {})
    return {"documents": records, "processing_status": docs.processing_status(summary)}


def _kind_label(slot: str) -> str:
    return {"limits": "credit-limit doc", "expiring": "expiring policy"}.get(slot, "quote")


def _add_entries(session: Session, project_id: str, entries: list[dict], actor: str) -> None:
    if not entries:
        return
    with projects_repo.project_lock(project_id):
        project = projects_repo.require(session, project_id, for_update=True)
        state = project.state or {}
        for entry in entries:
            state = apply.upsert_file_entry(state, entry)
        projects_repo.patch(session, project_id, {"state": state}, actor)
        session.commit()


@router.post("/projects/{project_id}/documents/{document_id}/rerun", response_model=DocumentOut,
             status_code=status.HTTP_202_ACCEPTED)
def rerun_document(project_id: str, document_id: str, session: Db, user: User,
                   engine: Annotated[EngineOverride, Query()] = "auto") -> dict:
    """Run the pipeline again on the stored file — idempotent: it refreshes
    this document's extractions only and keeps the broker's edits."""
    try:
        doc = docs.require(session, document_id, project_id)
    except docs.DocumentNotFound as exc:
        raise HTTPException(status_code=404, detail="Document not found.") from exc
    if doc.status in ("uploaded", "processing"):
        raise HTTPException(status_code=409, detail="This document is still being processed.")
    if not doc.storage_key:
        raise HTTPException(status_code=409, detail="This upload was rejected; upload a corrected file instead.")
    try:
        data = get_store().get(doc.storage_key)
    except StorageError as exc:
        raise HTTPException(status_code=409, detail="The stored file is no longer available.") from exc
    from app.api.routes import _resolve_file_kind  # noqa: PLC0415 — same package, avoids a cycle

    file_kind = _resolve_file_kind(doc.filename, doc.content_type)
    job_id = jobs.create_job(project_id=project_id, doc_kind=doc.slot, filename=doc.filename, actor=user["email"])
    doc.status, doc.stage, doc.error, doc.job_id, doc.attempts, doc.timings = "uploaded", "queued", None, job_id, 0, None
    doc.processed_at = None
    session.commit()
    session.refresh(doc)
    _add_entries(session, project_id, [apply.file_entry(
        doc.id, doc.filename, doc.slot, status="queued",
        meta=f"{_kind_label(doc.slot)} · queued · re-running", job_id=job_id)], user["email"])
    _forget_bytes(document_id)
    jobs.start_job(job_id, data, doc.filename, file_kind, engine, project_id=project_id,
                   doc_kind=doc.slot, actor=user["email"], document_id=doc.id)
    audit.record("document.rerun", target=document_id, actor=user["email"], project_id=project_id)
    return docs.serialize(doc)


# ── Records ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/documents", response_model=DocumentBatchOut)
def list_documents(
    project_id: str,
    session: Db,
    slot: Annotated[Slot | None, Query()] = None,
    status_filter: Annotated[DocumentStatus | None, Query(alias="status")] = None,
) -> dict:
    _require_project(session, project_id)
    rows = docs.list_for_project(session, project_id, slot=slot, status=status_filter)
    summary = docs.processing_summary(session, [project_id]).get(project_id, {})
    return {"documents": [docs.serialize(d) for d in rows],
            "processing_status": docs.processing_status(summary)}


@router.get("/projects/{project_id}/documents/{document_id}", response_model=DocumentOut)
def get_document(project_id: str, document_id: str, session: Db) -> dict:
    try:
        return docs.serialize(docs.require(session, document_id, project_id))
    except docs.DocumentNotFound as exc:
        raise HTTPException(status_code=404, detail="Document not found.") from exc


@router.delete("/projects/{project_id}/documents/{document_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def delete_document(project_id: str, document_id: str, session: Db, user: User) -> Response:
    """Remove the record and its stored object. The extraction result (if
    already folded into the comparison) is the project's own state and is
    untouched."""
    try:
        doc = docs.require(session, document_id, project_id)
    except docs.DocumentNotFound as exc:
        raise HTTPException(status_code=404, detail="Document not found.") from exc
    key = docs.delete(session, doc)
    session.commit()
    with projects_repo.project_lock(project_id):
        project = projects_repo.get(session, project_id, for_update=True)
        if project is not None:
            projects_repo.patch(session, project_id,
                                {"state": apply.remove_file_entry(project.state or {}, document_id)}, user["email"])
            session.commit()
    _forget_bytes(document_id)
    if key:
        try:
            get_store().delete(key)
        except StorageError as exc:
            logger.warning("Object %s left behind after record delete: %s", key, exc)
    audit.record("document.delete", target=document_id, actor=user["email"], project_id=project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Source page image (S5) ─────────────────────────────────────────────────

_PAGE_CACHE_MAX = 8
_bytes_cache: OrderedDict[str, bytes] = OrderedDict()
_bytes_lock = threading.Lock()


def _forget_bytes(document_id: str) -> None:
    with _bytes_lock:
        _bytes_cache.pop(document_id, None)


def _document_bytes(document_id: str) -> bytes | None:
    """The stored file, from the object store (small in-process LRU so the
    page-by-page viewer does not re-download the PDF per page), or from the
    legacy SQLite documents table for rows that predate the store."""
    with _bytes_lock:
        cached = _bytes_cache.get(document_id)
        if cached is not None:
            _bytes_cache.move_to_end(document_id)
            return cached
    data: bytes | None = None
    with session_scope() as session:
        doc = docs.get(session, document_id)
        key = doc.storage_key if doc else None
    if key:
        try:
            data = get_store().get(key)
        except StorageError as exc:
            logger.warning("Document %s unreadable from storage: %s", document_id, exc)
            return None
    elif doc is None:
        row = db.query_one("SELECT stored_path FROM documents WHERE id=?", (document_id,))
        if row is None:
            return None
        try:
            with open(row["stored_path"], "rb") as f:
                data = f.read()
        except OSError:
            return None
    if data is None:
        return None
    with _bytes_lock:
        _bytes_cache[document_id] = data
        _bytes_cache.move_to_end(document_id)
        while len(_bytes_cache) > _PAGE_CACHE_MAX:
            _bytes_cache.popitem(last=False)
    return data


@router.get("/documents/{document_id}/page/{page}")
def document_page(document_id: str, page: int) -> Response:
    """One page of a retained PDF as an image — S5: clicking a value opens
    the source page. Excel documents have no page image (404)."""
    data = _document_bytes(document_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        pdf = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Not a renderable PDF.") from exc
    try:
        if not 1 <= page <= pdf.page_count:
            raise HTTPException(status_code=404, detail="Page out of range.")
        png = pdf[page - 1].get_pixmap(dpi=120).tobytes("png")
        page_count = pdf.page_count
    finally:
        pdf.close()
    # X-Page-Count lets the viewer offer prev/next without a second request.
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600",
                             "X-Page-Count": str(page_count)})
