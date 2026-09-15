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

- **documents** — one row per uploaded file (BRD S4): `project_id → projects.id
  ON DELETE CASCADE`, `slot` (`quote` | `expiring` | `limits`), `filename`,
  `content_type`, `size_bytes`, `storage_backend` + `storage_key` (where the
  bytes live), `status` (`pending` → `processing` → `complete` | `failed`),
  `stage`, `error`, `page_count`, `job_id` (the extraction job), `uploaded_by`,
  `uploaded_at`, `updated_at`, `processed_at`.

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

## Documents and Supabase Storage (`app/storage.py`, `app/api/documents.py`)

Uploaded files are objects in **Supabase Storage** (a private bucket,
written and read server-side with the service-role key — it never reaches
the browser). The record in `documents` tracks each file's processing.

| Variable | Meaning |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (Project Settings → API). Required in production. |
| `SUPABASE_STORAGE_BUCKET` | Bucket name, default `documents`. Create it as **private**. |
| *(key empty)* | Development / tests: objects are files under `DATA_DIR/projects/<id>/docs/`. |

Object keys are `projects/<project_id>/docs/<document_id>_<safe filename>`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/projects/{id}/documents` (multipart: `files[]`, `slot`) | Upload up to 20 files into one slot → 202 with one record per file, in request order: `pending` + `job_id` for queued files, `failed` + `error` for files rejected up front (type, size, empty). |
| `GET` | `/projects/{id}/documents?slot=&status=` | The project's records. |
| `GET` | `/projects/{id}/documents/{doc}` | One record — poll for `status`. |
| `DELETE` | `/projects/{id}/documents/{doc}` | Remove the record and its object → 204. |
| `GET` | `/documents/{doc}/page/{n}` | Rendered PDF page (S5 source view), served from the store. |

The extraction worker moves a record `processing` → `complete` (with
`page_count`) or `failed` (with the reason); the job's result carries the
same `document_id`. Erasing a project deletes its objects and records. The
single-file `/extract-quote` and `/extract-jobs` paths still work and now
create the same records (already `complete`).

## Comparison grid (`app/services/grid.py`, `app/api/grid.py`)

The 16-row grid (BRD 2.3) is not a separate table: its columns and cells
are the `state.columns` / `state.confirmed` the review screen already
stores, so server-side edits and the screen's autosave describe one
document. Rows: `insurer` (header), `type` and `debt` (set fields, BRD
2.4 — project default / insurer rule, overridable per column), thirteen
extracted rows (the AI's original kept as `orig`), plus the broker-entered
`waiting_period` the screen carries (`extra: true`, not in the BRD list).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/projects/{id}/grid` | Row definitions, every column's cells (`value`, `orig`, `page`, `confidence`, `provenance` header/set/extracted/edited/manual/blank, `source` override/project/insurer_rule), confirmations, gate, review tick. |
| `GET` | `/projects/{id}/grid/fields` | The row definitions alone. |
| `PATCH` | `/projects/{id}/grid/columns/{col}/cells/{field}` `{value}` | One edit. Keeps `orig`, marks the cell human-verified, clears the row's confirmation if gated and the review tick. `insurer` renames the column; `type`/`debt` become overrides. |
| `DELETE` | `/projects/{id}/grid/columns/{col}/cells/{field}` | Revert to the AI's original (409 when there is none). |
| `PUT` / `DELETE` | `/projects/{id}/grid/columns/{col}/set-fields/{field}` `{value}` | Per-column override of `type` (one of the four policy types) or `debt` (Included / Outsourced); empty or DELETE clears it. |
| `GET` | `/projects/{id}/grid/confirmations` | The four gated flags (`confirmed`, `by`, `at`) and the gate (`complete`, `missing`). |
| `PUT` | `/projects/{id}/grid/confirmations/{field}` `{confirmed}` | Confirm / unconfirm one gated field: annual premium, indemnity, excess, max liability (422 otherwise). |
| `PUT` | `/projects/{id}/grid/confirmations` `{confirmed: {field: bool}}` | Bulk form, all-or-nothing. |

Every write returns the full grid (or the confirmations block) and is
audited by field/column, never by value. The web app still autosaves the
whole `state`; a stale save can overwrite a server-side edit made in
between — no optimistic-concurrency check exists yet.

## Credit limits (`app/services/limits.py`, `app/api/limits.py`)

The buyer × insurer table (BRD 2.6) lives in `state.credit` (rows),
`state.columns` (one column per insurer with a quote — the expiring policy
is not one) and `state.limitsHidden`, as the S6 screen stores them. Money
rule shared with the screen: numeric text → full pounds `£1,234,567`;
zero / nil / declined → `0` (a declined limit, distinct from blank);
other wording kept verbatim. Totals sum what parses.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/projects/{id}/limits` | Columns, hidden columns, rows (each cell: `value`, `provenance` extracted/edited/manual/blank, `amount`, `declined`), totals, `has_data`. |
| `POST` | `/projects/{id}/limits/rows` `{buyer, company_number, required, offers}` | Add a buyer → 201 with `Location`. |
| `PATCH` | `/projects/{id}/limits/rows/{row}` | Change buyer / company number / required limit. |
| `DELETE` | `/projects/{id}/limits/rows/{row}` | Remove the buyer → 204. |
| `PUT` / `DELETE` | `/projects/{id}/limits/rows/{row}/offers/{col}` `{value}` | Set / clear one insurer's offered limit for the buyer. |
| `PUT` | `/projects/{id}/limits/columns/{col}` `{hidden}` | Hide an insurer from the table (drops its offers) or restore it. |
| `GET` | `/projects/{id}/limits/export/xlsx` | Editable Excel workbook (values as typed, totals as formulas). |
| `GET` | `/projects/{id}/limits/export/pdf` | Editable PDF: every value cell is a text form field; totals printed. |

Downloads are built from the current table on each request, named
`Credit Limits - {Client}.{ext}`, and answer 409 when the table has no
content. The presentation's own credit-limit page and its `limits-xlsx`
export (S8) are unchanged.

## Recommendation (`app/services/recommendation.py`, `app/api/recommendation.py`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/projects/{id}/recommendation` | `insurer` (canonical name), `column_id`, `reasons`, `key_differences`, the `candidates` (columns with a quote) and the `declined` insurers. |
| `PUT` | `/projects/{id}/recommendation` `{insurer, reasons, key_differences}` | Set the recommended insurer by canonical name (legal names and ids are accepted too); it must own a quote column here — a declined insurer (approached, no quote) or one outside the project → 422. `null` clears the choice and keeps the texts. |

Stored in the working document as the S7 screen stores it (`recommended`
= column id, `reasons`, `keyDifferences`).

## Admin configuration (`app/services/config_store.py`, `app/api/config.py`)

The standing insurer list and the terminology map are **configuration,
not code** (BRD 2.3/2.4). They live as versioned documents in the
`config_documents` table (`name`, `data` JSONB, `version`, `updated_by`,
`updated_at`); the repository's `config/insurers.json` and
`config/terminology.json` are the seed used until an admin first saves.
`app/services/library.py` reads through the store — each worker re-checks
the version every two seconds, so a change applies to the next pipeline
run with no restart. Every save is audited (`config.insurers`,
`config.terminology`: who, when, version).

Role gate: `require_admin` — a Supabase user whose `app_metadata.role` is
`admin` (`cd web && npm run users -- role <email> admin`; set with the
service role, so it cannot be self-assigned) or an email in
`ADMIN_EMAILS`. Anyone else gets 403.

| Method | Path | Purpose |
|---|---|---|
| `GET` / `PUT` | `/config/insurers` | `insurers: [{id, name, legal_names, debt_collection: included\|outsourced, active}]` plus `version`, `updated_by`, `updated_at`, `source`. Ids are slugs; names must be unique across canonical and legal names; at least one insurer active. An insurer that still has terminology cannot be removed. |
| `GET` / `PUT` | `/config/terminology` | `fields: {standard field → [terms]}` for wording any insurer uses and `insurers: {insurer id → {standard field → [terms]}}` for one insurer's wording; every field key must be one of the 16 standard terms (`standard_fields` in the response), insurer keys must be standing-list ids. |

`GET /insurers` (the setup list) returns active insurers only; matching
of extracted names still knows inactive ones so old projects resolve.

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
