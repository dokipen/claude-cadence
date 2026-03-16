import { test, expect } from "./fixtures/auth";
import { test as unauthTest, expect as unauthExpect } from "@playwright/test";
import jwt from "jsonwebtoken";

const E2E_JWT_SECRET = "e2e-test-secret";
const E2E_USER_ID = "e2e-test-user";
const E2E_REFRESH_TOKEN = "e2e-refresh-token-hex-placeholder";

unauthTest.describe("unauthenticated", () => {
  unauthTest("shows login page with PAT input", async ({ page }) => {
    await page.goto("/login");
    await unauthExpect(page.locator("h1")).toHaveText("Cadence");
    await unauthExpect(page.locator('input[type="password"]')).toBeVisible();
    await unauthExpect(
      page.getByRole("button", { name: "Sign in with PAT" }),
    ).toBeVisible();
  });

  unauthTest("shows error on invalid PAT", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="password"]').fill("invalid-token");
    await page.getByRole("button", { name: "Sign in with PAT" }).click();
    await unauthExpect(page.getByRole("alert")).toHaveText(
      /Authentication failed/,
    );
  });

  unauthTest(
    "PAT login redirects to home page after successful auth",
    async ({ page }) => {
      const token = jwt.sign(
        { userId: E2E_USER_ID, jti: "e2e-pat-jti" },
        E2E_JWT_SECRET,
        { expiresIn: "1h" },
      );

      // Mock the authenticateWithGitHubPAT GraphQL mutation
      await page.route("**/graphql", async (route) => {
        const body = route.request().postDataJSON();
        if (body?.query?.includes("authenticateWithGitHubPAT")) {
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                authenticateWithGitHubPAT: {
                  token,
                  refreshToken: E2E_REFRESH_TOKEN,
                  user: {
                    id: E2E_USER_ID,
                    login: "e2e-tester",
                    displayName: "E2E Tester",
                    avatarUrl: null,
                  },
                },
              },
            }),
          });
        } else {
          await route.continue();
        }
      });

      await page.goto("/login");
      await page.locator('input[type="password"]').fill("ghp_validtokenvalue");
      await page.getByRole("button", { name: "Sign in with PAT" }).click();

      // Should redirect to home page after successful PAT auth
      // This FAILS because LoginPage.tsx calls login() but never calls navigate("/")
      await unauthExpect(page).toHaveURL("/");
    },
  );
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
