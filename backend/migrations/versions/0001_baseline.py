"""Baseline: the project store as first deployed, plus the exports table.

Revision ID: 0001_baseline
Revises: None

Adopts a database that `metadata.create_all` already built (every table is
created only when missing), so the first `alembic upgrade head` on the
existing production database records this revision without touching the
data. On an empty database it creates the full schema.

Frozen on purpose: later schema changes are new revisions, never edits here.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

JSON_DOC = sa.JSON().with_variant(JSONB(), "postgresql")


def _existing() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _existing()

    if "projects" not in existing:
        op.create_table(
            "projects",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("client_name", sa.String(200), nullable=False, server_default=""),
            sa.Column("reference", sa.String(100), nullable=False, server_default=""),
            sa.Column("project_type", sa.String(16), nullable=True),
            sa.Column("policy_type", sa.String(100), nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
            sa.Column("owner_email", sa.String(320), nullable=False, server_default=""),
            sa.Column("updated_by", sa.String(320), nullable=False, server_default=""),
            sa.Column("state", JSON_DOC, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_projects_updated_at", "projects", ["updated_at"])
        op.create_index("ix_projects_client_name", "projects", ["client_name"])
        op.create_index("ix_projects_reference", "projects", ["reference"])
        op.create_index("ix_projects_status", "projects", ["status"])

    if "project_insurers" not in existing:
        op.create_table(
            "project_insurers",
            sa.Column("project_id", sa.String(64),
                      sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("insurer_id", sa.String(40), primary_key=True),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        )
        op.create_index("ix_project_insurers_insurer_id", "project_insurers", ["insurer_id"])

    if "documents" not in existing:
        op.create_table(
            "documents",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("project_id", sa.String(64),
                      sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("slot", sa.String(16), nullable=False),
            sa.Column("filename", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(100), nullable=False,
                      server_default="application/octet-stream"),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("storage_backend", sa.String(16), nullable=False, server_default="local"),
            sa.Column("storage_key", sa.String(512), nullable=False, server_default=""),
            sa.Column("status", sa.String(16), nullable=False, server_default="uploaded"),
            sa.Column("stage", sa.String(40), nullable=False, server_default="queued"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("timings", JSON_DOC, nullable=True),
            sa.Column("job_id", sa.String(32), nullable=True),
            sa.Column("uploaded_by", sa.String(320), nullable=False, server_default=""),
            sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_documents_project_id", "documents", ["project_id"])
        op.create_index("ix_documents_status", "documents", ["status"])

    if "config_documents" not in existing:
        op.create_table(
            "config_documents",
            sa.Column("name", sa.String(40), primary_key=True),
            sa.Column("data", JSON_DOC, nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("updated_by", sa.String(320), nullable=False, server_default=""),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )

    if "exports" not in existing:
        op.create_table(
            "exports",
            sa.Column("project_id", sa.String(64),
                      sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("format", sa.String(16), primary_key=True),
            sa.Column("filename", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(100), nullable=False,
                      server_default="application/octet-stream"),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("storage_backend", sa.String(16), nullable=False, server_default="local"),
            sa.Column("storage_key", sa.String(512), nullable=False),
            sa.Column("generated_by", sa.String(320), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    raise NotImplementedError("The baseline is not reversible — it would drop every project.")
