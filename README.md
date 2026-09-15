# Insurance Quote Comparison Tool

> **Version 2 (this repository).** The rebuilt frontend lives in `web/`
> (Next.js 16 + Tailwind + shadcn/ui, Supabase Auth) with the FastAPI backend
> in `backend/` extended for it (bearer-token auth, background extraction
> jobs, recommendation-slide rules). The original release, with the vanilla
> `frontend/` SPA, stays deployed from the earlier repository; the two
> versions are kept apart so they can be deployed and compared side by side.

Internal tool for a UK credit-insurance brokerage: upload insurer quote PDFs,
review AI-extracted terms side by side, pick a recommendation, and generate a
client presentation.

- **Backend** — FastAPI pipeline: PyMuPDF (digital PDFs) / Azure Document
  Intelligence or open-source Docling OCR (scanned PDFs) → LLM Structured
  Outputs (Claude or OpenAI) → normalized, source-linked JSON. Every value
  carries the PDF page it came from (and its page position); missing values
  stay `null` — the system never guesses. The presentation is built with
  python-pptx on the client's approved template (artwork and fonts in
  `backend/app/assets`, wording in `backend/config/presentation.json`) and
  converted to PDF by LibreOffice headless; files and records live in
  Supabase Storage / PostgreSQL (Alembic migrations).
- **Frontend** — wireframe-faithful broker flow served at `/`:
  Login → Projects → Setup → Upload → Review & edit → Buyer credit limits →
  Recommendation → Generate & export.

## Repository layout — modular, frontend fully separate from backend

```
├── backend/                    Everything Python (FastAPI)
│   ├── app/
│   │   ├── main.py             App entrypoint: wiring, middleware, frontend mount
│   │   ├── api/routes.py       HTTP endpoints (/extract-quote, /generate-presentation, …)
│   │   ├── api/projects.py     project CRUD + search (docs/DATABASE.md)
│   │   ├── db/                 SQLAlchemy models + engine (PostgreSQL; SQLite fallback)
│   │   ├── core/               config.py (settings) · errors.py (client-safe → HTTP)
│   │   ├── models/             schemas.py (strict LLM schema) · presentation.py
│   │   ├── services/           pipeline.py · verification.py · presentation.py · library.py
│   │   ├── extraction/         detector · pymupdf · azure · docling · excel · base
│   │   └── llm/                router · prompt · openai_extractor · anthropic_extractor
│   ├── config/                 CONFIGURATION, not code (BRD 2.4) — edits need no release
│   │   ├── insurers.json       Standing insurer list, aliases, debt-collection rule
│   │   └── terminology.json    Mapping library: insurer wordings per comparison row
│   ├── tests/                  Pytest suite — no network, no API keys needed
│   ├── requirements*.txt       Pinned runtime / dev / optional-OCR dependencies
│   └── pyproject.toml          Ruff + pytest configuration
├── frontend/                   Zero Python — the broker SPA served by the backend at /
│   ├── index.html
│   ├── css/styles.css          Wireframe theme tokens
│   └── js/                     ES modules: constants · state · views · api · demo · main
├── web/                        Next.js 16 + Tailwind + shadcn/ui frontend (see web/README.md)
│   ├── src/app/                App Router: (auth)/login · (app)/projects/[id]/<step>
│   ├── src/components/         ui/ (shadcn) · layout/ (sidebar, topbar, stepper) · providers/
│   ├── src/lib/api/            Typed fetch client + endpoint modules for the backend
│   └── src/proxy.ts            Session-cookie route guard; /api/* proxies to the backend
├── docs/ARCHITECTURE.md        Pipeline diagram, design decisions, trust boundaries
├── .github/workflows/ci.yml    Lint (ruff) + tests on every push; web lint/typecheck/build
└── .env(.example)              Secrets at the repo root, shared by any run directory
```

## Deploying

`DEPLOY.md` covers UK/EU hosting end to end: the Supabase project (London
or Ireland region — database, auth, private storage bucket), the
environment variables (`deploy/.env.production.example`,
`deploy/web.env.production.example`), and three hosting routes with their
ready-made files — Fly.io London (`deploy/fly.toml`), Railway EU
(`deploy/railway.toml`), or any UK/EU VPS with Docker Compose + Caddy
(`deploy/docker-compose.yml`, `deploy/bootstrap-vps.sh`, `deploy/deploy.sh`).
CI publishes both container images to GHCR (`.github/workflows/docker-image.yml`).

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate               # Windows  (Linux/mac: source .venv/bin/activate)
pip install -r backend/requirements.txt
copy .env.example .env               # fill in ANTHROPIC_API_KEY (or OPENAI_API_KEY), AZURE_*
uvicorn app.main:app --app-dir backend --reload
```

- App: http://127.0.0.1:8000/
- API docs (Swagger): http://127.0.0.1:8000/docs
- Health/config check: http://127.0.0.1:8000/health

Next.js frontend (proxies `/api/*` to the backend above):

```bash
cd web && npm install && npm run dev      # http://localhost:3000
```

## API

```bash
curl -X POST "http://127.0.0.1:8000/extract-quote" -F "file=@quote.pdf"
```

Optional `?engine=digital|azure` forces an extraction engine (default `auto`
detects digital vs scanned). Response (abridged):

```json
{
  "meta": { "filename": "quote.pdf", "page_count": 4,
            "extraction_engine": "pymupdf", "llm_model": "gpt-4o-2024-08-06" },
  "review": {
    "missing_fields": ["minimum_annual_premium"],
    "uncertain_fields": ["discretionary_limit"],
    "confirm_required": ["estimated_annual_premium_exc_ipt", "indemnity",
                         "excess", "max_annual_liability"]
  },
  "set_fields": {
    "debt_collection_support": { "value": "Included", "source": "insurer_rule",
                                 "matched_insurer": "Atradius" }
  },
  "data": {
    "document_type": "insurer_quote",
    "insurer":  { "value": "Atradius", "page": 1, "confidence": "high" },
    "excess":   { "value": "£5,000",   "page": 2, "confidence": "high" },
    "excess_type": { "value": "Each and Every Loss", "page": 2, "confidence": "high" },
    "discretionary_limit": { "value": "£20,000", "page": 3, "confidence": "uncertain" },
    "minimum_annual_premium": { "value": null, "page": null, "confidence": null },
    "buyer_credit_limits": [
      { "buyer_name": "Example Ltd", "company_number": "01234567",
        "limit_required": "£250,000", "limit_offered": "£200,000", "page": 3 }
    ]
  }
}
```

The BRD 2.3 comparison list is definitive — 16 rows: insurer, type of policy
(broker-set), annual turnover, premium rate, est. annual premium (exc IPT),
minimum premium, credit-limit charges, debt collection support (rule-set),
indemnity, excess, excess type (insurer's own wording), max annual
liability, discretionary limit, max terms of payment, max extension period,
additional info. The two set fields never appear inside `data` — debt
collection arrives in `set_fields` from the insurer rule; type of policy is
chosen at project setup in the UI. Excel credit-limit schedules are accepted
alongside PDFs — both modern `.xlsx` and legacy `.xls` (format detected from
the file's bytes, not its name); each worksheet counts as one source page.

### Background extraction jobs (S4 status polling)

`POST /extract-jobs` takes the same multipart body as `/extract-quote` but
returns **202** at once with a job id; the pipeline runs on a worker thread.
`GET /extract-jobs/{id}` returns `status` (`queued` → `processing` → `done` |
`error`), `stage`, and on completion the full `/extract-quote` result under
`result` (or a client-safe `error` + `error_status`). Job state is stored in
SQLite so a poll can hit any gunicorn worker; at most three extractions run
at once per process and finished jobs are readable for 24 hours. The Next.js
upload screen (S4) uses this to show live per-file status and to resume
polling after a reload.

### Projects (PostgreSQL)

Projects are a relational resource (docs/DATABASE.md): searchable columns,
the ordered **insurers approached** relation, and the broker's working
document under `state`. `DATABASE_URL` points at PostgreSQL in production
(Supabase's connection string works as-is); empty falls back to a SQLite
file under `DATA_DIR` for development and tests.

| Method | Path | |
|---|---|---|
| `GET` | `/projects?q=&status=&project_type=&insurer=&sort=&limit=&offset=` | search / list → `{items, total, limit, offset}` |
| `POST` | `/projects` | create (201; `id` optional, 409 on clash) |
| `GET` `PUT` `PATCH` `DELETE` | `/projects/{id}` | detail · replace-or-create · partial update · erase (204) |
| `GET` `PUT` | `/projects/{id}/insurers` | the approached list · replace it in order |
| `POST` `DELETE` | `/projects/{id}/insurers/{insurer_id}` | add one · remove one |
| `POST` | `/projects/{id}/documents` (`files[]`, `slot`) | multi-file upload into a slot → 202, one record per file with `status` pending/processing/complete/failed |
| `GET` `DELETE` | `/projects/{id}/documents[/{doc}]` | list / poll a record · remove it and its stored file |
| `POST` | `/projects/{id}/documents/{doc}/rerun` | re-run the pipeline on a stored file (broker edits survive) |
| `GET` | `/projects/{id}/grid` | the 16-row comparison grid with cell provenance, confirmations and the export gate |
| `PATCH` `DELETE` | `/projects/{id}/grid/columns/{col}/cells/{field}` | edit one cell (keeps the AI original) · revert it |
| `PUT` `DELETE` | `/projects/{id}/grid/columns/{col}/set-fields/{field}` | per-column override of the set fields `type` / `debt` · clear it |
| `GET` `PUT` | `/projects/{id}/grid/confirmations[/{field}]` | the four gated confirmations (premium, indemnity, excess, max liability) |
| `GET` | `/projects/{id}/limits` | the credit-limits table: buyer rows × insurer columns with totals |
| `POST` `PATCH` `DELETE` | `/projects/{id}/limits/rows[/{row}]` | add · edit · remove a buyer row |
| `PUT` `DELETE` | `/projects/{id}/limits/rows/{row}/offers/{col}` | set · clear one insurer's offered limit |
| `GET` | `/projects/{id}/limits/export/{xlsx\|pdf}` | download the table as an editable Excel workbook or form-field PDF |
| `GET` `PUT` | `/projects/{id}/recommendation` | the recommended insurer (canonical name; must have a quote — declined → 422), reasons, key differences |
| `GET` `PUT` | `/config/insurers` · `/config/terminology` | admin only: standing insurer list + debt rule · terminology map (16 standard fields); versioned, audited, live on the next run |

Uploaded files live in **Supabase Storage** (`SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_STORAGE_BUCKET`; local files under `DATA_DIR` when unset).

## Extraction rules

1. **No guessing** — absent fields return `{"value": null, "page": null}`.
2. **Source linking** — every value carries its 1-based PDF page; out-of-range
   citations are stripped by a post-validation pass.
3. **Normalization via the mapping library** — insurer wordings map onto the
   brokerage's row labels using [backend/config/terminology.json](backend/config/terminology.json)
   (the client-compiled library; extend it without a release), **except**
   `excess_type`, which keeps the insurer's original wording.
4. **Set fields, never extracted** — "Type of policy" is broker-selected at
   setup; "Debt collection support" is set by the insurer rule in
   [backend/config/insurers.json](backend/config/insurers.json) (Allianz/Atradius/Coface →
   Included, everyone else → Outsourced) and returned in `set_fields`. Both
   are absent from the extraction schema entirely and editable per column.
5. **Review flags** — every value carries a `confidence` (`high`/`uncertain`);
   the `review` block lists missing and uncertain fields (computed
   server-side, never by the LLM) so the UI can highlight what a broker must
   verify before the comparison is exported.
6. **Document type** — each upload is classified as `insurer_quote`,
   `credit_limit_schedule`, `policy_document`, or `other`.

## Development

```bash
cd backend
pip install -r requirements-dev.txt
pytest        # 72 tests, no API keys or network needed
ruff check .  # lint (style, imports, bugbear, security rules)
```

CI runs both on every push (`.github/workflows/ci.yml`).

## Scanned PDFs — OCR engines

Scanned uploads route to **Azure Document Intelligence when its keys are
configured**, otherwise to the open-source **[Docling](https://github.com/docling-project/docling)**
engine (IBM) — chosen over Tesseract/EasyOCR/PaddleOCR because it is the
only pip-only option that reconstructs **table structure**, which buyer
credit-limit schedules depend on. Docling is a heavy optional dependency
(PyTorch); install it with:

```bash
pip install -r requirements-ocr.txt
```

The first conversion downloads models and is slow; later ones are faster.
Force an engine per upload with `?engine=azure` or `?engine=docling`;
`/health` reports which scanned-PDF engine is active.

## LLM providers

Extraction runs on either provider behind one shared prompt and one schema
— switching can never change the extraction contract:

| `.env` | Effect |
|---|---|
| `LLM_PROVIDER=auto` (default) | OpenAI when `OPENAI_API_KEY` is set, else the Claude API |
| `LLM_PROVIDER=openai` | OpenAI Responses API (`OPENAI_MODEL`, default gpt-4o) |
| `LLM_PROVIDER=anthropic` | Claude API (`ANTHROPIC_MODEL`, default `claude-haiku-4-5`) |

`/health` reports the active provider as `llm` (e.g.
`"anthropic:claude-haiku-4-5"`), and every extraction's `meta.llm_model`
records which provider/model produced it.

## Accuracy: the verification pass

After the LLM extracts, [verification.py](backend/app/services/verification.py)
deterministically checks **every value against the actual document text** —
verbatim first, then per-figure digit matching so "GBP 12,600" verifies
against a printed "£12,600.00". Wrong page citations are corrected, missing
ones recovered, and a value found nowhere in the document is downgraded to
`uncertain`, stripped of its page link, and listed in
`review.unverified_fields` — a hallucinated-but-plausible number can never
reach the broker marked as certain. Costs nothing: no extra API calls.

## Security notes

- Secrets live only in `.env` (gitignored); settings use `SecretStr` so keys
  can't leak into logs or errors. `/health` reports *whether* keys are set,
  never their values.
- Uploads are capped (25 MB, 60 pages / 10 worksheets) and read in
  size-checked chunks; error responses never expose internals.
- Per-IP rate limiting on the paid POST endpoints (`RATE_LIMIT_PER_MINUTE`,
  default 30); presentation payloads are size-capped field by field.
- Strict Content-Security-Policy (same-origin scripts only, no inline
  handlers), plus nosniff/frame/referrer headers.
- Document text is treated as untrusted LLM input: it is fenced between
  explicit markers and the prompt instructs the model to ignore any
  instruction-like content inside it (prompt-injection defense), while the
  strict output schema bounds what a poisoned document could do.
- The frontend HTML-escapes all extracted content before rendering.
- Not yet implemented (pilot scope): real authentication, rate limiting,
  server-side project storage. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Presentation export (BRD 2.8)

`POST /generate-presentation?format=pptx|pdf|limits-xlsx` renders the
reviewed project state into the 7-page presentation — cover (new-business /
renewal title), about, important information (with the auto-generated
declined-to-quote line), the 16-field terms comparison with the recommended
column highlighted, buyer credit limits (omitted cleanly when none),
comments & recommendation (name merged into the fixed FCA wording), and
contact. The PPTX uses only standard shapes/tables so it opens and edits
cleanly in Google Slides; `limits-xlsx` exports the buyer table as editable
Excel (BRD 2.6). The BRD 2.5 gate is enforced server-side: requests missing
any of the four confirmed key values get a 409. Regenerating replaces the
previous download; nothing is ever sent from the system.
