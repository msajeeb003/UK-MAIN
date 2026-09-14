import { test, expect } from "@playwright/test";
import {
  App,
  apiLogin,
  CONFIRM_REQUIRED_FIELDS,
  presentationPayload,
} from "../helpers/app";

// Flow 7: later wizard steps are locked until their prerequisites are met —
// verified at the UI (the step refuses to open and explains why) and, for the
// export prerequisite, at the server (409 until confirmed).
test.describe("Wizard step gating", () => {
  test("UI: each step unlocks only once its prerequisite is met", async ({ page }) => {
    const app = new App(page);
    await app.login();
    await app.newProject();

    // Setup incomplete -> Review is locked on the client name.
    await app.gotoStep("review");
    expect(await app.noticeText()).toMatch(/Complete Setup first/);
    await app.dismissNotice();
    await expect(page.getByRole("heading", { name: "New project" })).toBeVisible();

    // Name entered, but nothing uploaded -> Review still locked.
    await app.setClientName("Harwood Joinery Ltd");
    await app.continueToUpload();
    await app.gotoStep("review");
    expect(await app.noticeText()).toMatch(/Upload at least one document/);
    await app.dismissNotice();

    // A quote uploaded -> Review opens.
    await app.upload("quote", "quote-allianz.pdf");
    await app.gotoStep("review");
    await expect(page.getByRole("heading", { name: "Review & edit" })).toBeVisible();

    // Unconfirmed -> Generate is locked.
    await app.gotoStep("export");
    expect(await app.noticeText()).toMatch(/Confirm the four key values/);
    await app.dismissNotice();

    // Confirmed -> Generate opens.
    await app.confirmAll();
    await app.gotoStep("export");
    await expect(page.getByRole("heading", { name: "Generate & export" })).toBeVisible();
  });

  test("server: the Generate prerequisite (confirmation) is enforced with 409", async ({
    request,
  }) => {
    const { csrf } = await apiLogin(request);
    const res = await request.post("/generate-presentation?format=pdf", {
      headers: { "X-CSRF-Token": csrf },
      data: presentationPayload(CONFIRM_REQUIRED_FIELDS.slice(0, 2)),
    });
    expect(res.status()).toBe(409);
  });
});
