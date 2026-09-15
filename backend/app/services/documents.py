"""
Document records: one row per uploaded file, tracking where the bytes live
(object store key) and how far processing has got —
`pending` → `processing` → `complete` | `failed`.

Pure data access over app.db.models.Document plus the object-key
convention; the upload endpoint, the extraction worker and the erasure
path all go through here.
"""

from __future__ import annotations

import logging
import mimetypes
import re
import secrets
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.engine import session_scope
from app.db.models import DOCUMENT_SLOTS, DOCUMENT_STATUSES, Document, utcnow

logger = logging.getLogger(__name__)

_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
}


class DocumentNotFound(LookupError):
    pass


def new_id() -> str:
    return secrets.token_hex(12)


def content_type_for(filename: str) -> str:
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    return _CONTENT_TYPES.get(ext) or mimetypes.guess_type(filename)[0] or "application/octet-stream"


def object_key(project_id: str, document_id: str, filename: str) -> str:
    """`projects/<project>/docs/<doc>_<safe name>` — the layout the local
    backend, backups and erasure already know."""
    safe = re.sub(r"[^\w.\- ]", "_", filename)[-80:] or "upload"
    return f"projects/{project_id}/docs/{document_id}_{safe}"


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def serialize(doc: Document) -> dict:
    return {
        "id": doc.id,
        "project_id": doc.project_id,
        "slot": doc.slot,
        "filename": doc.filename,
        "content_type": doc.content_type,
        "size_bytes": doc.size_bytes,
        "status": doc.status,
        "stage": doc.stage,
        "error": doc.error,
        "page_count": doc.page_count,
        "job_id": doc.job_id,
        "storage_backend": doc.storage_backend,
        "uploaded_by": doc.uploaded_by,
        "uploaded_at": _aware(doc.uploaded_at),
        "updated_at": _aware(doc.updated_at),
        "processed_at": _aware(doc.processed_at),
    }


# ── CRUD (caller owns the session/commit) ─────────────────────────────────

def create(session: Session, *, document_id: str, project_id: str, slot: str, filename: str,
           content_type: str, size_bytes: int, storage_backend: str, storage_key: str,
           actor: str, status: str = "pending", stage: str = "queued",
           error: str | None = None, page_count: int = 0, job_id: str | None = None) -> Document:
    assert slot in DOCUMENT_SLOTS and status in DOCUMENT_STATUSES  # noqa: S101 — programmer error
    now = utcnow()
    doc = Document(
        id=document_id, project_id=project_id, slot=slot, filename=filename[:255],
        content_type=content_type[:100], size_bytes=size_bytes,
        storage_backend=storage_backend, storage_key=storage_key, status=status, stage=stage,
        error=error, page_count=page_count, job_id=job_id, uploaded_by=actor,
        uploaded_at=now, updated_at=now,
        processed_at=now if status in ("complete", "failed") else None,
    )
    session.add(doc)
    session.flush()
    return doc


def get(session: Session, document_id: str) -> Document | None:
    return session.get(Document, document_id)


def require(session: Session, document_id: str, project_id: str | None = None) -> Document:
    doc = get(session, document_id)
    if doc is None or (project_id is not None and doc.project_id != project_id):
        raise DocumentNotFound(document_id)
    return doc


def list_for_project(session: Session, project_id: str, *, slot: str | None = None,
                     status: str | None = None) -> list[Document]:
    stmt = select(Document).where(Document.project_id == project_id)
    if slot:
        stmt = stmt.where(Document.slot == slot)
    if status:
        stmt = stmt.where(Document.status == status)
    stmt = stmt.order_by(Document.uploaded_at.asc(), Document.id.asc())
    return list(session.scalars(stmt).all())


def storage_keys_for_project(session: Session, project_id: str) -> list[str]:
    stmt = select(Document.storage_key).where(
        Document.project_id == project_id, Document.storage_key != "")
    return list(session.scalars(stmt).all())


def delete(session: Session, doc: Document) -> str:
    """Remove the row; returns the object key for the caller to delete."""
    key = doc.storage_key
    session.delete(doc)
    session.flush()
    return key


# ── Status transitions (own a short session; safe from worker threads) ─────

def set_status(document_id: str, status: str, *, stage: str | None = None,
               error: str | None = None, page_count: int | None = None,
               job_id: str | None = None) -> bool:
    """Move a record along pending → processing → complete | failed. Returns
    False (and does nothing) if the record was deleted meanwhile."""
    assert status in DOCUMENT_STATUSES  # noqa: S101 — programmer error
    with session_scope() as session:
        doc = get(session, document_id)
        if doc is None:
            return False
        doc.status = status
        if stage is not None:
            doc.stage = stage
        if status == "failed":
            doc.error = (error or "Processing failed.")[:1000]
        elif status == "complete":
            doc.error = None
        if page_count is not None:
            doc.page_count = page_count
        if job_id is not None:
            doc.job_id = job_id
        doc.updated_at = utcnow()
        if status in ("complete", "failed"):
            doc.processed_at = doc.updated_at
        return True
