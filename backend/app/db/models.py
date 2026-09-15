"""
Relational schema for project management (SQLAlchemy 2.0, PostgreSQL).

Two tables:

- `projects` — one row per client comparison. The searchable, filterable
  facts (client, reference, type, status, timestamps) are real columns; the
  broker's working document (comparison columns, credit-limit rows, uploads,
  confirmations, recommendation…) is kept whole in `state` — JSONB on
  PostgreSQL, JSON elsewhere — because the server stores it verbatim and
  never edits it (BRD 2.9 / S2).
- `project_insurers` — the "insurers approached" list (BRD 2.2 / S3) as an
  ordered many-to-many between a project and the standing insurer list.
  Insurer ids are validated against config/insurers.json on write (the
  list is configuration, not code, so there is no `insurers` table to
  reference); the join rows cascade with their project.

`DATABASE_URL` selects the engine (see app/db/engine.py): PostgreSQL in
production, a local SQLite file for development and the test suite. The
model is dialect-neutral so both behave identically.
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

PROJECT_TYPES = ("new", "renewal")
PROJECT_STATUSES = ("draft", "ready", "sent", "closed")
# Upload slots (BRD S4): insurer quotes, the expiring policy, credit-limit
# schedules. Per-file processing status of an upload.
DOCUMENT_SLOTS = ("quote", "expiring", "limits")
DOCUMENT_STATUSES = ("pending", "processing", "complete", "failed")

JSONDocument = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    # Client-generated ids ("p-…" / 16 hex) are accepted so a project can be
    # created offline-first; the server mints one when the client sends none.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    reference: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    project_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    policy_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    # Who created / last saved it (email from the session or Supabase token).
    # Not used for access control: BRD 2.10 — every named user sees every
    # project. Kept for the audit trail and future per-desk filtering.
    owner_email: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    updated_by: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    state: Mapped[dict] = mapped_column(JSONDocument, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    # Last successful presentation generation (S8); NULL until then.
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    insurers: Mapped[list["ProjectInsurer"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="ProjectInsurer.position",
        lazy="selectin",
    )

    __table_args__ = (
        Index("ix_projects_updated_at", "updated_at"),
        Index("ix_projects_client_name", "client_name"),
        Index("ix_projects_reference", "reference"),
        Index("ix_projects_status", "status"),
    )


class ProjectInsurer(Base):
    """One insurer the broker approached for a project, in the order they
    were ticked (that order drives the comparison columns — S5)."""

    __tablename__ = "project_insurers"

    project_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True,
    )
    insurer_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    project: Mapped[Project] = relationship(back_populates="insurers")

    __table_args__ = (Index("ix_project_insurers_insurer_id", "insurer_id"),)


class Document(Base):
    """One uploaded file: which slot it fills, where its bytes live (object
    store key) and how far processing has got."""

    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False,
    )
    slot: Mapped[str] = mapped_column(String(16), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # "supabase" | "local" and the key within it ("" when nothing was stored,
    # e.g. a rejected upload that is kept only as a failed record).
    storage_backend: Mapped[str] = mapped_column(String(16), nullable=False, default="local")
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    stage: Mapped[str] = mapped_column(String(40), nullable=False, default="queued")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # The extraction job processing this file (app/api/jobs.py), while any.
    job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    uploaded_by: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_documents_project_id", "project_id"),
        Index("ix_documents_status", "status"),
    )


class ConfigDocument(Base):
    """An admin-maintained configuration document (BRD 2.3/2.4): the
    standing insurer list or the terminology map, versioned on every save.
    Until the first save the repository's config/*.json seed applies."""

    __tablename__ = "config_documents"

    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONDocument, nullable=False, default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
