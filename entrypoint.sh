#!/bin/sh
# Container entrypoint: take a safety backup BEFORE the app starts (and thus
# before any schema migration runs on the first request), then launch the
# server. The backup is best-effort — a transient offsite outage must not
# block startup — but it alerts loudly on failure (see app/backup.py).
#
# Behind a reverse proxy / platform edge (Caddy, Fly, Railway) the client IP
# arrives in X-Forwarded-For; FORWARDED_ALLOW_IPS says which proxies to
# trust for it (the login lockout and rate limit key on the client IP).
# Default "*" is right when the container is only reachable through the
# proxy; set it to the proxy's IP when the port is exposed directly.
set -e

python -m app.backup run --if-configured || echo "pre-start backup skipped/failed (see logs)"

# Versioned schema migrations for the PostgreSQL project store (Alembic,
# backend/migrations). The SQLite development fallback is created by the
# app itself, so nothing runs without a PostgreSQL DATABASE_URL.
case "${DATABASE_URL:-}" in
  postgres*) echo "==> Applying database migrations"
             python -m alembic -c backend/alembic.ini upgrade head ;;
  *)         echo "==> No PostgreSQL DATABASE_URL — migrations skipped" ;;
esac

exec gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker \
  --workers "${WORKERS:-${WEB_CONCURRENCY:-2}}" \
  --bind "0.0.0.0:${PORT:-8000}" \
  --timeout 180 \
  --graceful-timeout 30 \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}" \
  --access-logfile - \
  --log-level "${LOG_LEVEL:-info}"
