"""Row-level security scoped to internal users (Supabase).

Revision ID: 0003_row_level_security
Revises: 0002_check_constraints

PostgreSQL only (a no-op elsewhere). Supabase exposes every table in the
`public` schema through PostgREST, and its default privileges grant the
`anon` and `authenticated` roles access — so without RLS the publishable
key in the browser could read projects. With RLS enabled and policies for
`authenticated` only:

- `anon` (no sign-in) sees nothing;
- signed-in internal users (BRD 2.10: every named user sees every
  project, identical permissions) may read and write projects, the
  insurers-approached rows, documents and exports;
- the config documents are readable by every internal user and writable
  only by an admin (`app_metadata.role = 'admin'`, set with the service
  role — the same rule as the API's `require_admin`).

The API itself connects as the table owner (`postgres` through the
pooler), which bypasses RLS; a non-owner application role would need
`BYPASSRLS` or these same policies. `FORCE ROW LEVEL SECURITY` is
deliberately not used so the owner keeps working.
"""

from alembic import op
from sqlalchemy import text

revision = "0003_row_level_security"
down_revision = "0002_check_constraints"
branch_labels = None
depends_on = None

TABLES = ("projects", "project_insurers", "documents", "exports", "config_documents")
ADMIN = "coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'"


def _supabase(bind) -> bool:
    """Both Supabase pieces the policies rely on: the `authenticated` role
    and the `auth.jwt()` helper."""
    role = bind.execute(text("SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'")).scalar()
    fn = bind.execute(text("SELECT to_regprocedure('auth.jwt()')")).scalar()
    return bool(role) and fn is not None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    # Alembic's own bookkeeping table: nobody but the owner needs it.
    op.execute("ALTER TABLE alembic_version ENABLE ROW LEVEL SECURITY")
    if not _supabase(bind):
        return  # plain PostgreSQL: RLS on, owner-only until policies are added
    for table in TABLES:
        op.execute(f"DROP POLICY IF EXISTS internal_users_all ON {table}")
        op.execute(f"DROP POLICY IF EXISTS internal_users_read ON {table}")
        op.execute(f"DROP POLICY IF EXISTS admins_write ON {table}")
        if table == "config_documents":
            op.execute(
                "CREATE POLICY internal_users_read ON config_documents "
                "FOR SELECT TO authenticated USING (true)"
            )
            op.execute(
                "CREATE POLICY admins_write ON config_documents "
                f"FOR ALL TO authenticated USING ({ADMIN}) WITH CHECK ({ADMIN})"
            )
        else:
            op.execute(
                f"CREATE POLICY internal_users_all ON {table} "
                "FOR ALL TO authenticated USING (true) WITH CHECK (true)"
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in TABLES:
        for policy in ("internal_users_all", "internal_users_read", "admins_write"):
            op.execute(f"DROP POLICY IF EXISTS {policy} ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE alembic_version DISABLE ROW LEVEL SECURITY")
