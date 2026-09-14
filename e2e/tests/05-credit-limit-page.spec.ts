import { test, expect } from "@playwright/test";
import {
  App,
  apiLogin,
  CONFIRM_REQUIRED_FIELDS,
  presentationPayload,
} from "../helpers/app";

// Flow 5: the credit-limit page is present when a schedule is supplied and
// cleanly omitted when not — at the UI, and (server layer) the limits-xlsx
// export succeeds only when there are limits.
test.describe("Credit-limit page presence", () => {
  test("present when a schedule is uploaded", async ({ page }) => {
    const app = new App(page);
    await app.login();
    await app.newProject();
    await app.setClientName("Evercrest Foods Ltd");
    await app.continueToUpload();

    await app.upload("quote", "quote-allianz.pdf");
    await app.upload("limits", "limits-allianz.pdf");

    await app.gotoStep("limits");
    await expect(page.getByRole("heading", { name: "Buyer credit limits" })).toBeVisible();
    // The schedule's buyer rows populate the table.
    await expect(
      page.locator('input[data-edit="credit"][data-part="buyer"]'),
    ).not.toHaveCount(0);

    // On the Generate step the Excel-limits download is offered.
    await app.gotoStep("review");
    await app.confirmAll();
    await app.gotoStep("export");
    await expect(page.locator('[data-act="exportLimitsXlsx"]')).toBeVisible();
  });

  test("omitted when no schedule is supplied", async ({ page }) => {
    const app = new App(page);
    await app.login();
    await app.newProject();
    await app.setClientName("Foxglove Interiors Ltd");
    await app.continueToUpload();

    await app.upload("quote", "quote-allianz.pdf");

    await app.gotoStep("limits");
    await expect(page.getByText(/No buyer limits/)).toBeVisible();

    await app.gotoStep("review");
    await app.confirmAll();
    await app.gotoStep("export");
    // No limits -> no Excel-limits link in the export panel.
    await expect(page.locator('[data-act="exportLimitsXlsx"]')).toHaveCount(0);
  });

  test("server: limits-xlsx export requires credit limits", async ({ request }) => {
    const { csrf } = await apiLogin(request);
    const headers = { "X-CSRF-Token": csrf };

    // No credit limits -> refused (BRD 2.6: page omitted when none).
    let res = await request.post("/generate-presentation?format=limits-xlsx", {
      headers,
      data: presentationPayload(CONFIRM_REQUIRED_FIELDS),
    });
    expect(res.status()).toBe(422);

    // With a buyer row -> a real Excel workbook is produced.
    const withLimits = {
      ...presentationPayload(CONFIRM_REQUIRED_FIELDS),
      credit_limits: [
        {
          buyer: "Meridian Foods Ltd",
          company_number: "04821990",
          required: "£250,000",
          offers: { "col-a": "£200,000" },
        },
      ],
    };
    res = await request.post("/generate-presentation?format=limits-xlsx", {
      headers,
      data: withLimits,
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("spreadsheetml");
  });
});
