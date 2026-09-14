# End-to-end testing

Browser E2E tests live in [`e2e/`](../e2e/README.md) (Playwright + TypeScript)
and cover the seven critical broker journeys. This note records the design
decisions behind them.

## Deterministic extraction (`LLM_PROVIDER=stub`)

E2E must pass headless in CI with no API keys and no flakiness, but the upload
flow normally calls an LLM whose output is neither. So the backend gained a
deterministic, offline extractor selected with `LLM_PROVIDER=stub`
(`backend/app/llm/stub_extractor.py`).

- It reads marker lines (`INSURER:`, `DOCTYPE:`, `Indemnity: 90%`, `BUYER: …`)
  from the same page-tagged document text the real providers receive, and
  returns the same validated `QuoteExtraction`. Because the values are the
  document text, the normal verification pass confirms them — the whole
  pipeline (detection → extraction → verification → set-field rules) runs
  exactly as in production.
- It makes **no network calls and needs no keys**, so it is also a keyless
  local demo path.
- It is **refused in production**: `run_startup_checks()` makes
  `LLM_PROVIDER=stub` fatal when `APP_ENV=production`, and the no-training
  posture check skips it (there is no endpoint to vet).

This is additive and off by default — `auto`/`openai`/`anthropic` are
unchanged, and nothing selects the stub unless `LLM_PROVIDER=stub` is set
explicitly.

## Two layers for the gate and step-gating

The acceptance requires the confirmation gate and step-gating to be verified at
**both** the UI and the server:

- **UI** — Playwright drives the real frontend: export buttons stay `disabled`,
  and jumping to a locked step raises the app's notice instead of navigating.
- **Server** — Playwright's request API posts to `/generate-presentation`
  directly and asserts `409` until `confirmed_fields` is complete (the
  `ExportBlockedError` gate in `services/presentation.py`), and that
  `limits-xlsx` is refused with no credit limits. Other step prerequisites
  (client name, an uploaded document) are client-side wizard state; the one
  with server authority — the export confirmation gate — is asserted there.

The exported-deck specifics (credit-limit slide present/omitted, recommended
column highlight fill, regulatory wording) are additionally asserted at the
deck level in `backend/tests/test_presentation.py`, which inspects the rendered
PPTX/PDF.

## Browsers

`chromium` and `edge` (channel `msedge`) cover the Chrome/Edge users who export
to Google Slides; `webkit` exercises the vanilla-JS ES-module frontend on a
third engine.

## CI

`.github/workflows/e2e.yml`:

- **`e2e`** (every push/PR): matrix over chromium / edge / webkit, each booting
  the ephemeral stub backend via `e2e/scripts/serve.mjs`. This is the
  deterministic headless gate.
- **`e2e-staging`** (optional): runs the same specs against `E2E_STAGING_URL`
  when that repository variable is set — a post-deploy smoke test. Structural
  and gate assertions only, since extraction is real there.
