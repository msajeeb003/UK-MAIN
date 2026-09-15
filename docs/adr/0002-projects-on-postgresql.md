# ADR-0002: Project management on PostgreSQL

- **Status:** Accepted (supersedes the "SQLite now" part of ADR-0001 for projects)
- **Date:** 2026-09-15
- **Context owner:** platform / backend

## Context

ADR-0001 kept every table in one SQLite file until a trigger was hit. The
version-2 build brief asks for project management as RESTful endpoints on a
**PostgreSQL** database with full CRUD, search, and relational handling of
the "insurers approached" list. The BRD itself is silent on the database
engine; it fixes the behaviour (BRD 2.9 server-side storage, S2 list /
reopen, S3 insurers approached, 2.11 erasure and retention).

The Next.js frontend already signs in with Supabase Auth, so a Supabase
project — which ships a managed PostgreSQL — is the natural host.

## Decision

- Projects move to a relational store managed with **SQLAlchemy 2.0**
  (synchronous engine, `psycopg` 3 driver). `DATABASE_URL` selects the
  backend; empty falls back to a SQLite file for development and tests, and
  production refuses to boot without PostgreSQL.
- Schema: `projects` (searchable columns + the working document as JSONB)
  and `project_insurers` (ordered many-to-many keyed by the standing-list
  insurer id, cascading with the project). No `insurers` table: the
  standing list stays configuration (`config/insurers.json`, BRD 2.4) and
  ids are validated on write.
- The other tables (users/sessions for the classic SPA, documents, exports,
  extraction jobs, metrics, audit) **stay in SQLite** for now — they are
  file-adjacent or append-only and were not in the brief. They reference
  projects by id only; the per-project erase covers both stores.
- The API is resource-shaped (`client_name`, `reference`, …,
  `insurers_approached`, `state`); the clients map their flat project
  object at one edge (`web/src/lib/api/endpoints.ts`, `frontend/js/state.js`).
- Existing blob rows are imported once when the store first initialises.

## Consequences

- Search, filtering and paging happen in SQL; the project list no longer
  ships every blob to the browser to filter client-side.
- Production backups of projects are the provider's (Supabase PITR); the
  in-app backup keeps covering `app.db` and the files.
- Schema changes after the first production deploy should ship as Alembic
  migrations; `create_all` is only for the initial schema.
- Two stores in one process is a transitional state. Moving documents,
  exports and jobs across is a follow-up once the PostgreSQL path has run
  in staging.
