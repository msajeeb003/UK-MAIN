# Database — project management on PostgreSQL

Projects (the client comparisons brokers work on — BRD 2.9 / S2) live in a
relational store managed with SQLAlchemy 2.0. Everything else the backend
keeps (users and cookie sessions for the classic SPA, retained documents,
generated exports, extraction jobs, metrics, the audit log) stays in the
SQLite file at `DATA_DIR/app.db` — see `app/core/db.py`.

## Configuration

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:port/db` — production. Supabase's *Connect → URI* string works verbatim (the transaction-mode pooler on port 6543 is supported; server-side prepared statements are disabled for it). |
| *(empty)* | Development / tests: a SQLite file at `DATA_DIR/projects.db`, same schema, same code. |

In `APP_ENV=production` the process refuses to boot unless `DATABASE_URL`
points at PostgreSQL.

## Schema (`app/db/models.py`)

- **projects** — `id` (client- or server-generated, ≤ 64 chars), `client_name`,
  `reference`, `project_type` (`new` | `renewal`), `policy_type`, `status`
  (`draft` | `ready` | `sent` | `closed`), `owner_email`, `updated_by`,
  `created_at`, `updated_at`, `generated_at` (last presentation), and
  `state` — the broker's working document as JSONB (the server stores it
  verbatim and never edits it). Indexed on `updated_at`, `client_name`,
  `reference`, `status`.
- **project_insurers** — the ordered "insurers approached" list:
  `(project_id → projects.id ON DELETE CASCADE, insurer_id, position)`.
  Insurer ids are validated against `config/insurers.json` on every write
  (the standing list is configuration, not code — BRD 2.4), so there is no
  `insurers` table to join; names are resolved at read time.

The schema is created with `metadata.create_all` at start-up (idempotent).
Schema *changes* should be shipped as Alembic migrations once the first
production database exists; none are needed for the initial version.

## API (`app/api/projects.py`, all behind `require_user`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/projects?q=&status=&project_type=&insurer=&sort=&limit=&offset=` | Search / list. `q` matches client name or reference (case-insensitive). `status` may repeat. `sort`: `updated_desc` (default), `updated_asc`, `client_asc`, `client_desc`, `created_desc`, `created_asc`. Returns `{items, total, limit, offset}`. |
| `POST` | `/projects` | Create → 201. `id` optional. 409 if the id exists. |
| `GET` | `/projects/{id}` | Detail. |
| `PUT` | `/projects/{id}` | Replace, or create at that id (201 when created). |
| `PATCH` | `/projects/{id}` | Partial update — only fields present change. |
| `DELETE` | `/projects/{id}` | Right-to-erasure: relational rows, retained documents, exports, metrics and files → 204 (404 if unknown). |
| `GET` | `/projects/{id}/insurers` | The approached list with names and positions. |
| `PUT` | `/projects/{id}/insurers` | Replace the ordered list. |
| `POST` | `/projects/{id}/insurers/{insurer_id}` | Append one insurer (idempotent). |
| `DELETE` | `/projects/{id}/insurers/{insurer_id}` | Remove one insurer → 204. |

Unknown insurer ids → 422 listing them. `state` over 2 MB → 413.

## Migration from the blob table

Before this store existed, projects were one JSON blob per row in the SQLite
`projects` table. On the first start with the relational store, every blob
row whose id is not yet present is imported (`app/services/projects.py`
`import_legacy`): `clientName`, `ref`, `projectType`, `policyType`, `status`,
`approached` and `generatedAt` become columns / relation rows; the blob is
kept as `state`. The legacy rows are left in place and are cleaned up by the
normal per-project delete.

## Backups

On PostgreSQL the database is backed up by the provider (Supabase: daily
backups / PITR by plan). `app/backup.py` continues to snapshot `app.db` and
the document/export files. In the SQLite fallback, `projects.db` is **not**
part of that snapshot — the fallback is for development only.
