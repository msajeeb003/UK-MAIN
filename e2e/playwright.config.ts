import { defineConfig, devices } from "@playwright/test";

// Local runs boot the backend (deterministic stub extractor) via
// scripts/serve.mjs. Set E2E_BASE_URL to run the same specs against a
// deployed staging target instead — no local server is started then.
const PORT = process.env.E2E_PORT || "8099";
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;
const useLocalServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // projects are shared server-side (BRD 2.9), so serialise
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["html", { open: "never" }], ["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Chrome + Edge — the brokers export to Google Slides from these.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
    // At least one WebKit engine, for the vanilla-JS ES-module frontend.
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],

  webServer: useLocalServer
    ? {
        command: "node scripts/serve.mjs",
        url: `${baseURL}/health`,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
});
