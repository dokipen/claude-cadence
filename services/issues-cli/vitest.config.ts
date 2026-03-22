import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/e2e/**/*.e2e.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Run test files concurrently — each file gets its own server (PORT 0) and SQLite database
    fileParallelism: true,
    // Keep tests within each file sequential — tests depend on each other's state (IDs, FSM transitions)
    sequence: {
      concurrent: false,
    },
  },
});
