import { test, expect } from "./fixtures/auth";
import { test as unauthTest, expect as unauthExpect } from "@playwright/test";

unauthTest.describe("unauthenticated", () => {
  unauthTest("shows login page with PAT input", async ({ page }) => {
    await page.goto("/login");
    await unauthExpect(page.locator("h1")).toHaveText("Cadence");
    await unauthExpect(page.locator('input[type="password"]')).toBeVisible();
    await unauthExpect(
      page.getByRole("button", { name: "Sign in" }),
    ).toBeVisible();
  });

  unauthTest("shows error on invalid PAT", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="password"]').fill("invalid-token");
    await page.getByRole("button", { name: "Sign in" }).click();
    await unauthExpect(page.getByRole("alert")).toHaveText(
      /Authentication failed/,
    );
  });
});

test.describe("authenticated", () => {
  test("shows app shell with user info", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("user-info")).toBeVisible();
    await expect(page.getByTestId("user-info")).toHaveText("E2E Tester");
  });

  test("shows sign out button", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
  });

  test("logout clears session and shows login page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("user-info")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL("/login");
    await expect(page.locator("h1")).toHaveText("Cadence");
  });
});
