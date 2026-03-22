import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
    // Cap concurrent file workers to bound CI resource spike:
    // 11 E2E files × (3 execSync Prisma calls + 1 live tsx server) = up to 33 blocking children + 11 servers.
    // maxForks: 4 limits peak concurrency without eliminating the parallelism speedup.
    poolOptions: {
      forks: {
        maxForks: 4,
      },
    },
  },
});
