import { test, expect } from "@playwright/test";
import { App } from "../helpers/app";

// Flow 1: login -> new business project -> upload multiple quotes -> review
// -> confirm the four gated values -> select a recommendation -> generate
// PPTX + PDF -> download.
test.describe("New business — full journey", () => {
  test("two quotes, confirm four, recommend, generate + download PPTX and PDF", async ({
    page,
  }) => {
    const app = new App(page);
    await app.login();
    await app.newProject();

    await app.setClientName("Aldgate Timber Ltd");
    await app.chooseType("new");
    await app.continueToUpload();

    await app.upload("quote", ["quote-allianz.pdf", "quote-atradius.pdf"]);

    await page.getByRole("button", { name: /Review comparison/ }).click();
    await expect(page.getByRole("heading", { name: "Review & edit" })).toBeVisible();

    // One comparison column per uploaded quote (BRD 2.1).
    expect(await app.reviewColumnCount()).toBe(2);

    // Export is gated until the four key values are confirmed.
    await expect(page.getByText(/Confirm 4 of 4 key values/)).toBeVisible();
    await app.confirmAll();
    await expect(page.getByText(/All four key values confirmed/)).toBeVisible();

    await app.recommendFirstColumn();

    await app.gotoStep("export");
    await expect(page.getByRole("heading", { name: "Generate & export" })).toBeVisible();
    await expect(app.exportButton("Ppt")).toBeEnabled();
    await expect(app.exportButton("Pdf")).toBeEnabled();

    expect(await app.download("Ppt")).toMatch(/\.pptx$/);
    expect(await app.download("Pdf")).toMatch(/\.pdf$/);

    // A generated project surfaces its download links on the project list.
    await page.locator('[data-act="toProjects"]').first().click();
    await expect(
      page.getByRole("heading", { name: "Projects" }),
    ).toBeVisible();
    await expect(
      page.locator('#proj-rows a', { hasText: "PPT" }).first(),
    ).toBeVisible();
  });
});
