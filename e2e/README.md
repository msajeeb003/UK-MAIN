# Browser E2E tests (Playwright)

End-to-end tests for the critical broker journeys, driving the real frontend
against a real backend in Chrome, Edge and WebKit.

## The seven flows

| Spec | Flow |
|---|---|
| `01-new-business` | Login → new business → upload multiple quotes → review → confirm the four gated values → select a recommendation → generate PPTX + PDF → download |
| `02-renewal` | Renewal is blocked past Review until the expiring policy is uploaded, then generates with the renewal title |
| `03-confirmation-gate` | Export blocked until all four values are confirmed — **UI** (disabled buttons/locked step) **and server** (409) |
| `04-cumulative-upload` | A late quote adds a new column and refreshes the comparison without disturbing existing edits |
| `05-credit-limit-page` | Credit-limit page present when a schedule is supplied, cleanly omitted when not — UI and server (`limits-xlsx`) |
| `06-recommendation-highlight` | Selecting a recommendation highlights its column in the export tables; unselecting clears it |
| `07-wizard-step-gating` | Later wizard steps stay locked until their prerequisites are met — UI, plus the server-enforced export prerequisite (409) |

## How it runs deterministically

Extraction normally calls an LLM. For reproducible, keyless, offline runs the
backend is booted with `LLM_PROVIDER=stub` — a deterministic extractor that
reads marker lines from the uploaded document
(`backend/app/llm/stub_extractor.py`). The stub is **refused in production**.

`scripts/serve.mjs` boots the backend with a fresh SQLite data dir, the stub,
a seeded admin (`broker@ukcib.co.uk`), and rate limiting off. Playwright's
`webServer` starts it and waits for `/health`.

## Run locally

```bash
cd e2e
npm ci
npm run install:browsers          # chromium + webkit + msedge

# The launcher needs the backend's Python. Point PYTHON at your venv:
#   Windows:  PYTHON=../.venv/Scripts/python.exe
#   POSIX:    PYTHON=../.venv/bin/python
PYTHON=../.venv/Scripts/python.exe npm test
PYTHON=../.venv/Scripts/python.exe npx playwright test --project=chromium
npm run report                    # open the HTML report
```

The backend deps must be installed in that Python (`pip install -r
../backend/requirements.txt` — no OCR/LLM extras needed).

## Fixtures

`fixtures/*.pdf` are committed and carry the stub's marker lines. Regenerate
them after a content change:

```bash
npm run fixtures      # python fixtures/generate_fixtures.py
```

## Against staging

Set `E2E_BASE_URL` to a deployed URL to run the same specs there (no local
server is started). Extraction is real, so the specs assert structure and the
gate — never exact extracted values. CI runs this automatically when the
repository variable `E2E_STAGING_URL` is set; see `.github/workflows/e2e.yml`.

```bash
E2E_BASE_URL=https://staging.example \
E2E_ADMIN_EMAIL=broker@ukcib.co.uk E2E_ADMIN_PASSWORD='…' \
npx playwright test
```
