"""
Document uploads (BRD S4 / 2.9): multi-file upload into a slot, per-file
processing records, listing, removal, and the rendered source page.

`POST /projects/{id}/documents` takes any number of files for ONE slot
(`quote` | `expiring` | `limits`), stores each in the object store
(Supabase Storage in production), creates a `documents` record per file and
queues the extraction. It returns 202 with the records — status `pending`
for queued files, `failed` (with the reason) for files rejected up front —
so the client has an id to poll from the first response. The extraction
worker moves each record through `processing` to `complete` or `failed`.
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
from app.services import documents as docs
from app.services import projects as projects_repo
from app.services.pipeline import EngineOverride
from app.storage import StorageError, get_store

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_user)])

Slot = Literal["quote", "expiring", "limits"]
DocumentStatus = Literal["pending", "processing", "complete", "failed"]
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
    job_id: str | None
    storage_backend: str
    uploaded_by: str
    uploaded_at: datetime
    updated_at: datetime
    processed_at: datetime | None


class DocumentBatchOut(BaseModel):
    documents: list[DocumentOut]


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
                status="failed", stage="rejected", error=str(exc.detail),
            )
            session.commit()
            records.append(docs.serialize(rec))
            continue

        key = docs.object_key(project_id, doc_id, filename)
        content_type = docs.content_type_for(filename)
        try:
            store.put(key, data, content_type)
        except StorageError as exc:
            logger.error("Storing %s for project %s failed: %s", filename, project_id, exc)
            rec = docs.create(
                session, document_id=doc_id, project_id=project_id, slot=slot,
                filename=filename, content_type=content_type, size_bytes=len(data),
                storage_backend=store.backend, storage_key="", actor=actor,
                status="failed", stage="storage", error="Could not store the file — try again.",
            )
            session.commit()
            records.append(docs.serialize(rec))
            continue

        # The job row exists before the record is committed, so the record
        # carries its job id from the first response and no status update
        # from the worker can race the assignment.
        job_id = jobs.create_job(project_id=project_id, doc_kind=slot, filename=filename, actor=actor)
        rec = docs.create(
            session, document_id=doc_id, project_id=project_id, slot=slot,
            filename=filename, content_type=content_type, size_bytes=len(data),
            storage_backend=store.backend, storage_key=key, actor=actor,
            status="pending", stage="queued", job_id=job_id,
        )
        session.commit()
        records.append(docs.serialize(rec))
        jobs.start_job(job_id, data, filename, file_kind, engine, project_id=project_id,
                       doc_kind=slot, actor=actor, document_id=doc_id)

    return {"documents": records}


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
    return {"documents": [docs.serialize(d) for d in rows]}


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
