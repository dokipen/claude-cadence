import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Run tests sequentially — E2E tests share a server and may depend on order within a suite
    sequence: {
      concurrent: false,
    },
  },
});
