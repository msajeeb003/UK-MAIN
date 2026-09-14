import { test, expect } from "@playwright/test";
import {
  App,
  apiLogin,
  CONFIRM_REQUIRED_FIELDS,
  presentationPayload,
} from "../helpers/app";

// Flow 3: export is blocked until all four values are confirmed — verified at
// BOTH the UI (disabled buttons + locked step) and the server (409 on a
// request whose confirmed_fields is incomplete).
test.describe("Confirmation gate", () => {
  test("UI: export buttons stay disabled until all four are confirmed", async ({
    page,
  }) => {
    const app = new App(page);
    await app.login();
    await app.newProject();
    await app.setClientName("Cardinal Logistics Ltd");
    await app.continueToUpload();
    await app.upload("quote", "quote-allianz.pdf");
    await page.getByRole("button", { name: /Review comparison/ }).click();

    // With none/some confirmed, jumping to Generate is refused.
    await app.gotoStep("export");
    expect(await app.noticeText()).toMatch(/Confirm the four key values/);
    await app.dismissNotice();

    // Confirm three of four — still blocked.
    await app.toggleConfirm("premium");
    await app.toggleConfirm("indemnity");
    await app.toggleConfirm("excess");
    await app.gotoStep("export");
    expect(await app.noticeText()).toMatch(/Confirm the four key values/);
    await app.dismissNotice();

    // The fourth unlocks the step and the export buttons.
    await app.toggleConfirm("maxLiability");
    await app.gotoStep("export");
    await expect(app.exportButton("Ppt")).toBeEnabled();
    await expect(app.exportButton("Pdf")).toBeEnabled();
  });

  test("server: /generate-presentation returns 409 until confirmed_fields is complete", async ({
    request,
  }) => {
    const { csrf } = await apiLogin(request);
    const headers = { "X-CSRF-Token": csrf };

    // Missing all four -> blocked.
    let res = await request.post("/generate-presentation?format=pptx", {
      headers,
      data: presentationPayload([]),
    });
    expect(res.status()).toBe(409);

    // Three of four -> still blocked.
    res = await request.post("/generate-presentation?format=pptx", {
      headers,
      data: presentationPayload(CONFIRM_REQUIRED_FIELDS.slice(0, 3)),
    });
    expect(res.status()).toBe(409);

    // All four -> generation succeeds and streams a PPTX.
    res = await request.post("/generate-presentation?format=pptx", {
      headers,
      data: presentationPayload(CONFIRM_REQUIRED_FIELDS),
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("presentationml");
  });
});
