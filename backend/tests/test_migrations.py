"""Alembic migrations for the project store (backend/migrations).

Run against throwaway SQLite databases: the baseline adopts an existing
`create_all` schema, a fresh database gets the full schema, the CHECK
constraints reject bad values, and the chain is repeatable. The RLS
revision is PostgreSQL-only and skips itself here.
"""

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

from app.db.models import Base

BACKEND = Path(__file__).resolve().parent.parent
TABLES = {"projects", "project_insurers", "documents", "config_documents", "exports"}


def _config(url: str) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def _url(tmp_path: Path, name: str) -> str:
    return "sqlite:///" + (tmp_path / name).as_posix()


def _check_names(engine: sa.Engine, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(engine).get_check_constraints(table)}


def test_fresh_database_gets_the_full_schema_and_constraints(tmp_path):
    url = _url(tmp_path, "fresh.db")
    command.upgrade(_config(url), "head")

    engine = sa.create_engine(url)
    tables = set(sa.inspect(engine).get_table_names())
    assert TABLES <= tables and "alembic_version" in tables
    assert {"ck_projects_status", "ck_projects_project_type"} <= _check_names(engine, "projects")
    assert {"ck_documents_slot", "ck_documents_status"} <= _check_names(engine, "documents")
    assert "ck_exports_format" in _check_names(engine, "exports")

    with engine.begin() as conn:
        conn.execute(sa.text("PRAGMA foreign_keys=ON"))
        conn.execute(sa.text(
            "INSERT INTO projects (id, state, created_at, updated_at, status) "
            "VALUES ('p1', '{}', '2026-01-01', '2026-01-01', 'draft')"
        ))
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(sa.text(
                "INSERT INTO projects (id, state, created_at, updated_at, status) "
                "VALUES ('p2', '{}', '2026-01-01', '2026-01-01', 'archived')"
            ))
    with engine.begin() as conn, pytest.raises(sa.exc.IntegrityError):
        conn.execute(sa.text(
            "INSERT INTO exports (project_id, format, filename, storage_key, created_at) "
            "VALUES ('p1', 'docx', 'x', 'k', '2026-01-01')"
        ))
    with engine.begin() as conn:
        version = conn.execute(sa.text("SELECT version_num FROM alembic_version")).scalar()
    assert version == "0003_row_level_security"
    engine.dispose()

    # Repeatable: nothing to do the second time.
    command.upgrade(_config(url), "head")


def test_baseline_adopts_a_create_all_database(tmp_path):
    """The production database was built by metadata.create_all before
    migrations existed: the first upgrade must keep its tables and data."""
    url = _url(tmp_path, "adopted.db")
    engine = sa.create_engine(url)
    Base.metadata.create_all(engine, tables=[
        Base.metadata.tables[t] for t in ("projects", "project_insurers", "documents", "config_documents")
    ])
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO projects (id, client_name, reference, owner_email, updated_by, "
            "state, created_at, updated_at, status) "
            "VALUES ('keep', 'Kept Ltd', '', '', '', '{}', '2026-01-01', '2026-01-01', 'sent')"
        ))
    engine.dispose()

    command.upgrade(_config(url), "head")

    engine = sa.create_engine(url)
    assert TABLES <= set(sa.inspect(engine).get_table_names())
    with engine.begin() as conn:
        assert conn.execute(sa.text("SELECT client_name FROM projects WHERE id='keep'")).scalar() == "Kept Ltd"
    assert "ck_projects_status" in _check_names(engine, "projects")
    engine.dispose()


def test_constraints_downgrade_and_baseline_refuses_to_drop_data(tmp_path):
    url = _url(tmp_path, "down.db")
    command.upgrade(_config(url), "head")
    command.downgrade(_config(url), "0001_baseline")
    engine = sa.create_engine(url)
    assert _check_names(engine, "projects") == set()
    assert TABLES <= set(sa.inspect(engine).get_table_names())
    engine.dispose()
    with pytest.raises(NotImplementedError):
        command.downgrade(_config(url), "base")
