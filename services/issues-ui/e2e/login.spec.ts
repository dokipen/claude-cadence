import { test, expect } from "./fixtures/auth";
import { test as unauthTest, expect as unauthExpect } from "@playwright/test";

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
      // Mock the authenticateWithGitHubPAT GraphQL mutation
      await page.route("**/graphql", async (route) => {
        const body = route.request().postDataJSON();
        if (body?.query?.includes("authenticateWithGitHubPAT")) {
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                authenticateWithGitHubPAT: {
                  token: "fake-jwt-for-pat-test",
                  refreshToken: "fake-refresh-token",
                  user: {
                    id: "e2e-test-user",
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
      await unauthExpect(page).toHaveURL("/");
    },
  );

  unauthTest(
    "PAT login with redirect param navigates to intended page after auth",
    async ({ page }) => {
      // Mock the authenticateWithGitHubPAT GraphQL mutation
      await page.route("**/graphql", async (route) => {
        const body = route.request().postDataJSON();
        if (body?.query?.includes("authenticateWithGitHubPAT")) {
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                authenticateWithGitHubPAT: {
                  token: "fake-jwt-for-pat-test",
                  refreshToken: "fake-refresh-token",
                  user: {
                    id: "e2e-test-user",
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

      await page.goto("/login?redirect=%2Fticket%2F123");
      await page.locator('input[type="password"]').fill("ghp_validtokenvalue");
      await page.getByRole("button", { name: "Sign in with PAT" }).click();

      // Should redirect to the intended page after successful PAT auth
      await unauthExpect(page).toHaveURL("/ticket/123");
    },
  );

  unauthTest(
    "PAT login without redirect param navigates to home after auth",
    async ({ page }) => {
      // Mock the authenticateWithGitHubPAT GraphQL mutation
      await page.route("**/graphql", async (route) => {
        const body = route.request().postDataJSON();
        if (body?.query?.includes("authenticateWithGitHubPAT")) {
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                authenticateWithGitHubPAT: {
                  token: "fake-jwt-for-pat-test",
                  refreshToken: "fake-refresh-token",
                  user: {
                    id: "e2e-test-user",
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

      // Should redirect to home when no redirect param is present
      await unauthExpect(page).toHaveURL("/");
    },
  );

  unauthTest(
    "PAT login with malicious redirect navigates to home after auth",
    async ({ page }) => {
      // Mock the authenticateWithGitHubPAT GraphQL mutation
      await page.route("**/graphql", async (route) => {
        const body = route.request().postDataJSON();
        if (body?.query?.includes("authenticateWithGitHubPAT")) {
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              data: {
                authenticateWithGitHubPAT: {
                  token: "fake-jwt-for-pat-test",
                  refreshToken: "fake-refresh-token",
                  user: {
                    id: "e2e-test-user",
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

      // Protocol-relative URL that would redirect off-site
      await page.goto("/login?redirect=%2F%2Fevil.com");
      await page.locator('input[type="password"]').fill("ghp_validtokenvalue");
      await page.getByRole("button", { name: "Sign in with PAT" }).click();

      // Malicious redirect should be blocked; fall back to home
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
