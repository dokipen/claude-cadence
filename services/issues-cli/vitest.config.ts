import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/e2e/globalSetup.ts"],
    include: ["src/**/*.test.ts", "test/e2e/**/*.e2e.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // fileParallelism defaults to true in Vitest 3; set explicitly to document intent:
    // each E2E file gets its own server (PORT 0) and SQLite database, so parallel execution is safe
    fileParallelism: true,
    // Keep tests within each file sequential — tests depend on each other's state (IDs, FSM transitions)
    sequence: {
      concurrent: false,
    },
  },
});
