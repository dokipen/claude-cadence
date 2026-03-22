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
    // Each E2E file runs 3 sequential execSync Prisma calls then holds a live tsx server.
    // Without a cap all 11 files run simultaneously: up to 11 concurrent blocking Prisma calls + 11 live servers.
    // maxForks: 4 limits peak concurrency to 4 blocking calls + 4 servers without eliminating the speedup.
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 4,
      },
    },
  },
});
