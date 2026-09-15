"""
Engine and session management for the relational project store.

`DATABASE_URL` (app/core/config.py) chooses the backend:

- `postgresql://…` — production. Supabase's connection string works as-is;
  psycopg's server-side prepared statements are disabled so the
  transaction-mode pooler (PgBouncer, port 6543) is safe too.
- empty — a local SQLite file at `<DATA_DIR>/projects.db` for development
  and the test suite. Same schema, same code path.

The engine is created lazily on first use (so a TestClient without the
lifespan still works) and rebuilt if the URL changes (tests repoint
DATA_DIR). Schema creation is idempotent (`create_all`); the first start
also imports any projects still in the legacy SQLite blob table.
"""

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Base

logger = logging.getLogger(__name__)

_lock = threading.RLock()
_engine: Engine | None = None
_engine_url = ""
_legacy_imported_for = ""


def _build(url: str) -> Engine:
    if url.startswith("sqlite"):
        engine = create_engine(url, connect_args={"check_same_thread": False}, future=True)

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record) -> None:  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")       # ON DELETE CASCADE needs this
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=5000")
            cur.close()

        return engine
    return create_engine(
        url,
        pool_pre_ping=True,          # drop stale pooled connections quietly
        pool_size=5,
        max_overflow=5,
        pool_recycle=1800,
        # PgBouncer in transaction mode cannot track named prepared statements.
        connect_args={"prepare_threshold": None},
        future=True,
    )


def get_engine() -> Engine:
    """The process-wide engine for the configured DATABASE_URL."""
    global _engine, _engine_url, _legacy_imported_for
    url = get_settings().database_url_effective
    with _lock:
        if _engine is None or _engine_url != url:
            if _engine is not None:
                _engine.dispose()
            if url.startswith("sqlite:///"):
                from pathlib import Path
                Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
            engine = _build(url)
            Base.metadata.create_all(engine)
            _add_missing_columns(engine)
            _engine, _engine_url = engine, url
            logger.info("Project store ready (%s)", "postgresql" if url.startswith("postgresql") else "sqlite")
        engine = _engine
        run_import = _legacy_imported_for != url
        if run_import:
            _legacy_imported_for = url          # once per URL, even if it fails
    # The legacy import reads the insurer list, which itself reads config
    # from this store: run it with the engine published and the lock free
    # (the lock is re-entrant as a further safeguard).
    if run_import:
        _import_legacy(engine)
    return engine


def _add_missing_columns(engine: Engine) -> None:
    """Additive schema upkeep: `create_all` only creates missing tables, so
    a column added to a model after the first deploy is added here with
    `ALTER TABLE … ADD COLUMN` (nullable or defaulted, so existing rows are
    fine). Renames, drops and type changes still need a real migration."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in present:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                default = ""
                if column.default is not None and getattr(column.default, "is_scalar", False):
                    arg = column.default.arg
                    default = f" DEFAULT {arg!r}" if isinstance(arg, str) else f" DEFAULT {arg}"
                nullable = "" if column.nullable or default else " NULL"
                conn.execute(text(
                    f"ALTER TABLE {table.name} ADD COLUMN {column.name} {col_type}{default}{nullable}"  # noqa: S608 — identifiers from the model, not user input
                ))
                logger.info("Schema upkeep: added %s.%s", table.name, column.name)


def _import_legacy(engine: Engine) -> None:
    """One-way copy of projects still held in the legacy SQLite blob table
    (app/core/db.py) so nothing is lost when the relational store is first
    switched on. Rows already present are left alone."""
    from app.services import projects as repo

    try:
        with Session(engine) as session:
            count = repo.import_legacy(session)
            session.commit()
    except Exception:  # noqa: BLE001 — never block start-up on the legacy path
        logger.exception("Legacy project import failed")
        return
    if count:
        logger.info("Imported %d legacy project(s) into the relational store", count)


def init_db() -> None:
    """Create the schema and run the legacy import (called from the lifespan)."""
    get_engine()


def dispose() -> None:
    global _engine, _engine_url, _legacy_imported_for
    with _lock:
        if _engine is not None:
            _engine.dispose()
        _engine, _engine_url, _legacy_imported_for = None, "", ""


@contextmanager
def session_scope() -> Iterator[Session]:
    """A unit of work: commits on success, rolls back on error."""
    session = Session(get_engine())
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one session per request; the endpoint commits."""
    session = Session(get_engine())
    try:
        yield session
    finally:
        session.close()
