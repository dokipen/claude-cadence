import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const issuesDir = path.resolve(__dirname, "../issues");
const testDbUrl = `file:${path.resolve(issuesDir, "test.db")}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: [
    {
      command: `cd ${issuesDir} && DATABASE_URL=${testDbUrl} JWT_SECRET=e2e-test-secret npm start`,
      port: 4000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      env: { VITE_GITHUB_CLIENT_ID: "e2e-test-client-id" },
    },
  ],
});
