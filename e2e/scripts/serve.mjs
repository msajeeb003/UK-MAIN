// Boot the backend for the E2E suite: a fresh, isolated SQLite data dir,
// the deterministic offline extractor (LLM_PROVIDER=stub — no keys, no
// network), a seeded admin, and rate limiting off so a burst of uploads in a
// test never trips the limiter. Cross-platform; Playwright's webServer runs
// this and waits for the port. Nothing here touches the real .env values that
// matter (env vars set below take precedence over the .env file).

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const PORT = process.env.E2E_PORT || "8099";
const DATA_DIR = resolve(HERE, "..", ".data");

// Start each run from a clean database + document store so tests are
// order-independent and repeatable.
rmSync(DATA_DIR, { recursive: true, force: true });

const python =
  process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

const env = {
  ...process.env,
  DATA_DIR,
  LLM_PROVIDER: "stub",
  APP_ENV: "development",
  COOKIE_SECURE: "false",
  RATE_LIMIT_PER_MINUTE: "0",
  ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL || "broker@ukcib.co.uk",
  ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD || "e2e-Str0ng-Passw0rd",
  // Never let a developer's real keys reach a test run.
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
};

const child = spawn(
  python,
  ["-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--port", PORT],
  { cwd: REPO, env, stdio: "inherit" },
);

child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
