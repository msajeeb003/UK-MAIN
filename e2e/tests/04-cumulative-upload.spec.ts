import { test, expect } from "@playwright/test";
import { App } from "../helpers/app";

// Flow 4: uploads are cumulative. Adding a late quote creates a new column
// and refreshes the comparison WITHOUT disturbing edits already made to the
// existing columns.
test.describe("Cumulative upload", () => {
  test("a late quote adds a column and preserves prior edits", async ({ page }) => {
    const app = new App(page);
    await app.login();
    await app.newProject();
    await app.setClientName("Dunmore Packaging Ltd");
    await app.continueToUpload();

    await app.upload("quote", ["quote-allianz.pdf", "quote-atradius.pdf"]);
    await page.getByRole("button", { name: /Review comparison/ }).click();
    expect(await app.reviewColumnCount()).toBe(2);

    // Edit a cell in the first column (premium rate) and confirm it persists.
    const rateCell = page
      .locator('input.cell-input[data-field="premium_rate"]')
      .first();
    await rateCell.fill("0.99% (broker edited)");
    await rateCell.blur();

    // Add a late quote from a third insurer via the Upload step.
    await app.gotoStep("upload");
    await app.upload("quote", "quote-coface.pdf");
    await page.getByRole("button", { name: /Review comparison/ }).click();

    // New column appeared…
    expect(await app.reviewColumnCount()).toBe(3);
    // …and the earlier edit is untouched.
    await expect(
      page.locator('input.cell-input[data-field="premium_rate"]').first(),
    ).toHaveValue("0.99% (broker edited)");
  });
});
