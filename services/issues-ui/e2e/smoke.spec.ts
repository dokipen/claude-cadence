import { test, expect } from "@playwright/test";

test("dev server loads with Cadence branding", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Cadence");
});
