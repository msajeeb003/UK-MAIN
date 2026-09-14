import { test, expect } from "@playwright/test";
import { App } from "../helpers/app";

// Flow 2: a renewal cannot proceed past Review until the expiring policy is
// uploaded — it is the comparison baseline (BRD). With it, the journey
// completes like new business but with the renewal cover title.
test.describe("Renewal — expiring policy required", () => {
  test("blocked without the expiring policy, then generates once supplied", async ({
    page,
  }) => {
    const app = new App(page);
    await app.login();
    await app.newProject();

    await app.setClientName("Blackwater Steel Ltd");
    await app.chooseType("renewal");
    await expect(page.getByText(/expiring policy must be uploaded/)).toBeVisible();
    await app.continueToUpload();

    // A quote alone is not enough for a renewal — the expiring policy gates
    // the later steps.
    await app.upload("quote", "quote-allianz.pdf");
    await app.gotoStep("recommend");
    expect(await app.noticeText()).toMatch(/expiring policy/i);
    await app.dismissNotice();

    // Supply the expiring policy; the renewal baseline column now exists.
    await app.upload("expiring", "expiring-allianz.pdf");

    await page.getByRole("button", { name: /Review comparison/ }).click();
    await expect(page.getByRole("heading", { name: "Review & edit" })).toBeVisible();
    // Expiring baseline + the quote = two columns; the expiring one is named.
    await expect(page.locator('input.head-input[value^="Expiring"]')).toBeVisible();

    await app.confirmAll();
    await app.recommendFirstColumn();

    await app.gotoStep("export");
    await expect(
      page.getByText(/Renewal Credit Insurance Presentation/),
    ).toBeVisible();
    expect(await app.download("Ppt")).toMatch(/\.pptx$/);
  });
});
