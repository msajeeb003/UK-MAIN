"""Generated exports (BRD 2.8 / 2.9 / S2): the latest PowerPoint, PDF and
credit-limit workbook of a project.

PRD stack: generated presentations live in **Supabase Storage** next to
the original PDFs, and their records in PostgreSQL. Regenerating a format
replaces the previous file under the same object key — no versioning in
this build (BRD 2.8). The object store is the same one retained documents
use (`app/storage.py`: Supabase in production, local files in
development), so backups and erasure cover both alike.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.engine import session_scope
from app.db.models import EXPORT_FORMATS, Export, utcnow
from app.services import projects as projects_repo
from app.storage import get_store

logger = logging.getLogger(__name__)

CONTENT_TYPES = {
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pdf": "application/pdf",
    "limits-xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
EXTENSIONS = {"pptx": "pptx", "pdf": "pdf", "limits-xlsx": "xlsx"}


def object_key(project_id: str, format: str) -> str:
    """`projects/<project>/exports/<format>.<ext>` — the layout the local
    backend, backups and erasure already know. One key per format, so a
    regeneration overwrites the previous file."""
    if format not in EXPORT_FORMATS:
        raise ValueError(f"unknown export format {format!r}")
    return f"projects/{project_id}/exports/{format}.{EXTENSIONS[format]}"


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def serialize(row: Export) -> dict:
    return {
        "project_id": row.project_id,
        "format": row.format,
        "filename": row.filename,
        "content_type": row.content_type,
        "size_bytes": row.size_bytes,
        "storage_backend": row.storage_backend,
        "storage_key": row.storage_key,
        "generated_by": row.generated_by,
        "created_at": _aware(row.created_at).isoformat(),
    }


def store(project_id: str, format: str, filename: str, content: bytes,
          actor: str = "") -> dict:
    """Keep the latest export of `format` for the project: the bytes go to
    the object store first (a failed upload leaves the previous record
    valid), then the record is upserted under the project's write lock.
    Raises StorageError when the store refuses the object."""
    key = object_key(project_id, format)
    content_type = CONTENT_TYPES[format]
    store_ = get_store()
    store_.put(key, content, content_type)
    with projects_repo.project_lock(project_id), session_scope() as session:
        projects_repo.ensure(session, project_id, actor)
        row = session.get(Export, (project_id, format))
        if row is None:
            row = Export(project_id=project_id, format=format)
            session.add(row)
        row.filename = filename[:255]
        row.content_type = content_type
        row.size_bytes = len(content)
        row.storage_backend = store_.backend
        row.storage_key = key
        row.generated_by = actor[:320]
        row.created_at = utcnow()
        session.flush()
        out = serialize(row)
    logger.info("Export stored", extra={"extra_fields": {
        "event": "export_stored", "project_id": project_id, "format": format,
        "bytes": len(content), "backend": store_.backend,
    }})
    return out


def get(session: Session, project_id: str, format: str) -> Export | None:
    return session.get(Export, (project_id, format))


def read(row: Export) -> bytes:
    """The stored bytes (raises StorageError when the object is gone)."""
    return get_store().get(row.storage_key)


def list_for_project(session: Session, project_id: str) -> list[Export]:
    stmt = select(Export).where(Export.project_id == project_id).order_by(Export.format)
    return list(session.scalars(stmt))


def storage_keys_for_project(session: Session, project_id: str) -> list[str]:
    stmt = select(Export.storage_key).where(Export.project_id == project_id)
    return [key for key in session.scalars(stmt) if key]
