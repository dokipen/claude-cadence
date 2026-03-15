import { test as base } from "@playwright/test";
import jwt from "jsonwebtoken";

const E2E_JWT_SECRET = "e2e-test-secret";
const E2E_USER_ID = "e2e-test-user";
const E2E_REFRESH_TOKEN = "e2e-refresh-token-hex-placeholder";

export const test = base.extend({
  page: async ({ page }, use) => {
    const token = jwt.sign(
      { userId: E2E_USER_ID, jti: "e2e-test-jti" },
      E2E_JWT_SECRET,
      { expiresIn: "1h" },
    );

    await page.addInitScript(
      ({ token, refreshToken }) => {
        localStorage.setItem("token", token);
        localStorage.setItem("refreshToken", refreshToken);
      },
      { token, refreshToken: E2E_REFRESH_TOKEN },
    );

    await use(page);
  },
});

export { expect } from "@playwright/test";
