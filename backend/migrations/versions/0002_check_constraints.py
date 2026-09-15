"""Value sets as CHECK constraints (types, statuses, slots, formats).

Revision ID: 0002_check_constraints
Revises: 0001_baseline

The value sets live in app/db/models.py (PROJECT_TYPES, PROJECT_STATUSES,
DOCUMENT_SLOTS, DOCUMENT_STATUSES, EXPORT_FORMATS, STORAGE_BACKENDS) and
are validated in Python; this makes the database refuse anything else too.
CHECK constraints rather than PostgreSQL enum types: no column type change
on a live table, and the SQLite development store gets the same rule.
"""

from alembic import op

revision = "0002_check_constraints"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def _in(column: str, values: tuple[str, ...], nullable: bool = False) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    clause = f"{column} IN ({quoted})"
    return f"({column} IS NULL OR {clause})" if nullable else clause


CONSTRAINTS: list[tuple[str, str, str]] = [
    ("projects", "ck_projects_project_type", _in("project_type", ("new", "renewal"), nullable=True)),
    ("projects", "ck_projects_status", _in("status", ("draft", "ready", "sent", "closed"))),
    ("project_insurers", "ck_project_insurers_position", "position >= 0"),
    ("documents", "ck_documents_slot", _in("slot", ("quote", "expiring", "limits"))),
    ("documents", "ck_documents_status",
     _in("status", ("uploaded", "processing", "ready", "unreadable"))),
    ("documents", "ck_documents_storage_backend", _in("storage_backend", ("local", "supabase"))),
    ("exports", "ck_exports_format", _in("format", ("pptx", "pdf", "limits-xlsx"))),
    ("exports", "ck_exports_storage_backend", _in("storage_backend", ("local", "supabase"))),
]


def upgrade() -> None:
    for table, name, condition in CONSTRAINTS:
        # batch mode rebuilds the table on SQLite; on PostgreSQL it is a plain ALTER.
        with op.batch_alter_table(table) as batch:
            batch.create_check_constraint(name, condition)


def downgrade() -> None:
    for table, name, _ in reversed(CONSTRAINTS):
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(name, type_="check")
