import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { resolve } from "node:path";

/** Same credentials the E2E server seeds (see scripts/serve.mjs). Against a
 *  real staging target, override with E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD. */
export const CREDENTIALS = {
  email: process.env.E2E_ADMIN_EMAIL || "broker@ukcib.co.uk",
  password: process.env.E2E_ADMIN_PASSWORD || "e2e-Str0ng-Passw0rd",
};

/** True when the deterministic stub extractor is serving (local runs). Against
 *  staging (E2E_BASE_URL set) extraction is real, so value-exact assertions on
 *  extracted content are skipped; structural assertions still hold. */
export const DETERMINISTIC = !process.env.E2E_BASE_URL;

export const fixture = (name: string): string => resolve(__dirname, "..", "fixtures", name);

/** The four values BRD 2.5 gates export on (UI confirm-flag keys). */
export const CONFIRM_KEYS = ["premium", "indemnity", "excess", "maxLiability"] as const;

/** Page object for the single-page wizard. Selectors mirror the app's
 *  data-act / data-edit contract (frontend/js/main.js). */
export class App {
  constructor(public readonly page: Page) {}

  async login(): Promise<void> {
    await this.page.goto("/");
    await this.page.fill("#login-email", CREDENTIALS.email);
    await this.page.fill("#login-pass", CREDENTIALS.password);
    await this.page.click('[data-act="signIn"]');
    await expect(this.page.getByRole("heading", { name: "Projects" })).toBeVisible();
  }

  async newProject(): Promise<void> {
    await this.page.click('[data-act="newProject"]');
    await expect(this.page.getByRole("heading", { name: "New project" })).toBeVisible();
  }

  async setClientName(name: string): Promise<void> {
    const input = this.page.locator('input[data-edit="proj"][data-part="clientName"]');
    await input.fill(name);
    await input.blur();
  }

  async chooseType(type: "new" | "renewal"): Promise<void> {
    await this.page.click(`[data-act="setType"][data-arg="${type}"]`);
  }

  async continueToUpload(): Promise<void> {
    await this.page.getByRole("button", { name: /Continue to upload/ }).click();
    await expect(this.page.getByRole("heading", { name: "Upload documents" })).toBeVisible();
  }

  /** Upload one or more files into a slot and wait until extraction settles. */
  async upload(slot: "quote" | "limits" | "expiring", files: string | string[]): Promise<void> {
    const list = (Array.isArray(files) ? files : [files]).map(fixture);
    const before = await this.extractedCount();
    await this.page.setInputFiles(`#file-${slot}`, list);
    await expect
      .poll(() => this.extractedCount(), { timeout: 30_000 })
      .toBe(before + list.length);
  }

  extractedCount(): Promise<number> {
    return this.page.locator(".status-pill", { hasText: "Extracted" }).count();
  }

  /** Click a stepper item (a div — distinct from the footer nav buttons). */
  async gotoStep(id: string): Promise<void> {
    await this.page.locator(`div[data-act="go"][data-arg="${id}"]`).click();
  }

  async reviewColumnCount(): Promise<number> {
    return this.page.locator("input.head-input").count();
  }

  /** Toggle one of the four confirmation chips in the review banner. */
  async toggleConfirm(key: string): Promise<void> {
    await this.page.locator(`span[data-act="toggleConfirm"][data-arg="${key}"]`).click();
  }

  async confirmAll(): Promise<void> {
    for (const key of CONFIRM_KEYS) {
      const chip = this.page.locator(`span[data-act="toggleConfirm"][data-arg="${key}"]`);
      // Chip is "✓ …" once confirmed; only click the ones still unconfirmed.
      if (!(await chip.innerText()).trim().startsWith("✓")) await chip.click();
    }
  }

  /** Set the recommendation to the first comparison column (review screen). */
  async recommendFirstColumn(): Promise<string> {
    const setRec = this.page.locator('span[data-act="pickRec"]').first();
    const colId = await setRec.getAttribute("data-arg");
    await setRec.click();
    return colId ?? "";
  }

  exportButton(kind: "Ppt" | "Pdf"): Locator {
    return this.page.locator(`button[data-act="export${kind}"]`);
  }

  /** Click an export button and capture the resulting download. */
  async download(kind: "Ppt" | "Pdf"): Promise<string> {
    const [download] = await Promise.all([
      this.page.waitForEvent("download"),
      this.exportButton(kind).click(),
    ]);
    return download.suggestedFilename();
  }

  /** The themed notice dialog text (replaces alert()); "" when none open. */
  async noticeText(): Promise<string> {
    const notice = this.page.locator(".modal-overlay").last();
    if (!(await notice.isVisible().catch(() => false))) return "";
    return (await notice.innerText()).trim();
  }

  async dismissNotice(): Promise<void> {
    await this.page.getByRole("button", { name: "OK" }).click();
  }
}

/** Log in through the API and return a context whose cookie jar holds the
 *  session, plus the CSRF token the write endpoints require. Used for the
 *  server-layer gate assertions, independent of the browser UI. */
export async function apiLogin(
  request: APIRequestContext,
): Promise<{ csrf: string }> {
  const res = await request.post("/auth/login", {
    data: { email: CREDENTIALS.email, password: CREDENTIALS.password },
  });
  expect(res.ok()).toBeTruthy();
  return { csrf: (await res.json()).csrf_token as string };
}

/** A minimal-but-valid /generate-presentation payload. `confirmed` lists the
 *  backend field names the broker has confirmed. */
export function presentationPayload(confirmed: string[]) {
  return {
    client_name: "Server Gate Ltd",
    reference: "UKCIB-9000",
    project_type: "new",
    columns: [
      {
        id: "col-a",
        name: "Allianz Trade",
        values: {
          type: "Whole Turnover",
          estimated_annual_premium_exc_ipt: "£14,400",
          indemnity: "90%",
          excess: "£1,000",
          max_annual_liability: "£2,000,000",
        },
      },
    ],
    recommended_id: "col-a",
    approached_insurers: ["Allianz Trade"],
    credit_limits: [],
    notes: "",
    reasons: "",
    confirmed_fields: confirmed,
  };
}

/** All four backend confirm-field names (BRD 2.5). */
export const CONFIRM_REQUIRED_FIELDS = [
  "estimated_annual_premium_exc_ipt",
  "indemnity",
  "excess",
  "max_annual_liability",
];
