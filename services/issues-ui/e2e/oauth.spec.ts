import { test, expect } from "@playwright/test";
import jwt from "jsonwebtoken";

const E2E_JWT_SECRET = "e2e-test-secret";
const E2E_USER_ID = "e2e-test-user";
const E2E_REFRESH_TOKEN = "e2e-refresh-token-hex-placeholder";

test.describe("OAuth", () => {
  test("shows 'Sign in with GitHub' button on login page", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: "Sign in with GitHub" }),
    ).toBeVisible();
  });

  test("OAuth callback exchanges code for token and redirects to board", async ({
    page,
  }) => {
    const token = jwt.sign(
      { userId: E2E_USER_ID, jti: "e2e-oauth-jti" },
      E2E_JWT_SECRET,
      { expiresIn: "1h" },
    );

    // Mock the authenticateWithGitHubCode GraphQL mutation
    await page.route("**/graphql", async (route) => {
      const body = route.request().postDataJSON();
      if (
        body?.query?.includes("authenticateWithGitHubCode")
      ) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              authenticateWithGitHubCode: {
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

    // Set the OAuth state in sessionStorage before navigating to callback
    await page.addInitScript(() => {
      sessionStorage.setItem("oauth_state", "test-state-123");
    });

    await page.goto("/auth/callback?code=test-code&state=test-state-123");

    // Should redirect to the board after successful auth
    await expect(page).toHaveURL("/");
    await expect(page.getByTestId("user-info")).toHaveText("E2E Tester");
  });

  test("OAuth callback with oauth_redirect in sessionStorage navigates to that path after auth", async ({
    page,
  }) => {
    const token = jwt.sign(
      { userId: E2E_USER_ID, jti: "e2e-oauth-redirect-jti" },
      E2E_JWT_SECRET,
      { expiresIn: "1h" },
    );

    // Mock the authenticateWithGitHubCode GraphQL mutation
    await page.route("**/graphql", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.query?.includes("authenticateWithGitHubCode")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              authenticateWithGitHubCode: {
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

    // Set both the OAuth state and the redirect target in sessionStorage
    await page.addInitScript(() => {
      sessionStorage.setItem("oauth_state", "test-state-456");
      sessionStorage.setItem("oauth_redirect", "/ticket/some-id");
    });

    await page.goto("/auth/callback?code=test-code&state=test-state-456");

    // Should redirect to the intended path stored in sessionStorage
    await expect(page).toHaveURL("/ticket/some-id");
  });

  test("OAuth callback without oauth_redirect in sessionStorage navigates to home after auth", async ({
    page,
  }) => {
    const token = jwt.sign(
      { userId: E2E_USER_ID, jti: "e2e-oauth-no-redirect-jti" },
      E2E_JWT_SECRET,
      { expiresIn: "1h" },
    );

    // Mock the authenticateWithGitHubCode GraphQL mutation
    await page.route("**/graphql", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.query?.includes("authenticateWithGitHubCode")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              authenticateWithGitHubCode: {
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

    // Set only the OAuth state, no redirect target
    await page.addInitScript(() => {
      sessionStorage.setItem("oauth_state", "test-state-789");
    });

    await page.goto("/auth/callback?code=test-code&state=test-state-789");

    // Should default to home when no redirect is stored — root redirects to /projects/:id
    await expect(page).toHaveURL(/\/projects\//);
    await expect(page.getByTestId("user-info")).toHaveText("E2E Tester");
  });

  test("OAuth callback shows error on missing code", async ({ page }) => {
    await page.goto("/auth/callback");
    await expect(page.getByRole("alert")).toHaveText(
      /Missing authorization code/,
    );
    await expect(page.getByText("Back to login")).toBeVisible();
  });

  test("OAuth callback shows error on state mismatch", async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("oauth_state", "correct-state");
    });

    await page.goto("/auth/callback?code=test-code&state=wrong-state");
    await expect(page.getByRole("alert")).toHaveText(/state mismatch/);
  });

  test("OAuth callback shows error when GitHub denies access", async ({
    page,
  }) => {
    await page.goto("/auth/callback?error=access_denied");
    await expect(page.getByRole("alert")).toHaveText(
      /authorization was denied/,
    );
  });
});
