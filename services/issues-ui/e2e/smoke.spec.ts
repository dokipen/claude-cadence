import { test, expect } from "@playwright/test";

test("unauthenticated visit redirects to login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/login");
  await expect(page.locator("h1")).toHaveText("Cadence");
});
