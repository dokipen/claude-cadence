import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const issuesDir = path.resolve(__dirname, "../issues");
const testDbUrl = `file:${path.resolve(issuesDir, "test.db")}`;

// Use a non-default port in CI to avoid conflicting with the production service
// (port 4444 is Selenium WebDriver's default — use 14444 to avoid collisions)
const apiPort = parseInt(process.env.E2E_API_PORT ?? "", 10) || (process.env.CI ? 14444 : 4000);
const devPort = parseInt(process.env.E2E_DEV_PORT ?? "", 10) || (process.env.CI ? 5174 : 5173);

// When QA_URL is set, tests run against the full docker-compose stack.
// Skip the local webServer setup — the QA stack serves everything at QA_URL.
const useQAStack = !!process.env.QA_URL;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: useQAStack ? undefined : "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${devPort}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: useQAStack
    ? undefined
    : [
        {
          command: `cd ${issuesDir} && DATABASE_URL=${testDbUrl} JWT_SECRET=e2e-test-secret RATE_LIMIT_GENERAL_MAX=10000 PORT=${apiPort} npm start`,
          port: apiPort,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: `npm run dev -- --port ${devPort}`,
          port: devPort,
          reuseExistingServer: !process.env.CI,
          env: {
            VITE_GITHUB_CLIENT_ID: "e2e-test-client-id",
            VITE_API_PORT: String(apiPort),
          },
        },
      ],
});
