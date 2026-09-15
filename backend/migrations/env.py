"""Alembic environment for the project store (app/db/models.py).

The URL is resolved in this order: `-x url=...` on the command line,
`sqlalchemy.url` in alembic.ini, then the application's `DATABASE_URL`
(app/core/config.py — the same value the API uses, so migrations always
target the database the app is about to serve).
"""

from alembic import context
from sqlalchemy import create_engine, pool

from app.db.models import Base

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    override = context.get_x_argument(as_dictionary=True).get("url")
    if override:
        return override
    configured = config.get_main_option("sqlalchemy.url")
    if configured:
        return configured
    from app.core.config import get_settings

    return get_settings().database_url_effective


def _is_sqlite(url: str) -> bool:
    return url.startswith("sqlite")


def run_migrations_offline() -> None:
    """Emit SQL without connecting (`alembic upgrade head --sql`)."""
    url = _url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=_is_sqlite(url),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _url()
    connect_args = {} if _is_sqlite(url) else {"prepare_threshold": None}  # pooler-safe
    engine = create_engine(url, poolclass=pool.NullPool, connect_args=connect_args, future=True)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=_is_sqlite(url),
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
