import { test, expect } from "@playwright/test";

test("unauthenticated visit redirects to login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/login");
  await expect(page.locator("h1")).toHaveText("Cadence");
});

test("unauthenticated visit to protected route includes redirect param in login URL", async ({ page }) => {
  await page.goto("/ticket/some-id");
  await expect(page).toHaveURL("/login?redirect=%2Fticket%2Fsome-id");
  await expect(page.locator("h1")).toHaveText("Cadence");
});
