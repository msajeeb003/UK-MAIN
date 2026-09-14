import { test, expect } from "@playwright/test";
import { App } from "../helpers/app";

// Flow 6: selecting a recommendation highlights that insurer's column in the
// exported comparison tables; unselecting it clears the highlight.
test.describe("Recommendation highlight", () => {
  test("highlight appears in the export tables and clears on unselect", async ({
    page,
  }) => {
    const app = new App(page);
    await app.login();
    await app.newProject();
    await app.setClientName("Granville Textiles Ltd");
    await app.continueToUpload();
    await app.upload("quote", ["quote-allianz.pdf", "quote-atradius.pdf"]);
    await page.getByRole("button", { name: /Review comparison/ }).click();
    await app.confirmAll();

    const preview = page.locator("#export-preview");
    const hasHighlight = () =>
      preview.evaluate((el) => el.innerHTML.includes("var(--rec)"));

    // Select a recommendation, then look at the export preview tables.
    await app.recommendFirstColumn();
    await app.gotoStep("export");
    expect(await hasHighlight()).toBe(true);

    // Unselect it (clicking the recommended card again), and the highlight goes.
    await app.gotoStep("recommend");
    await page.locator('[data-act="pickRec"]').first().click();
    await app.gotoStep("export");
    expect(await hasHighlight()).toBe(false);
  });
});
