import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ISSUES_DIR = path.resolve(__dirname, "../../issues");

// CI ports must match playwright.config.ts
const CI_API_PORT = 14444;
const CI_DEV_PORT = 5174;

/** Kill any stale process listening on a port. Best-effort, ignores errors. */
function killPortProcess(port: number) {
  try {
    execSync(`lsof -ti:${port} | xargs -r kill -9 2>/dev/null`, { stdio: "ignore" });
  } catch {
    // No process on port, or kill failed — both are fine.
  }
}

export default function globalSetup() {
  // In CI, stale processes from previous failed runs may hold ports.
  if (process.env.CI) {
    killPortProcess(CI_API_PORT);
    killPortProcess(CI_DEV_PORT);
  }

  // Remove stale test database so migrations start from scratch.
  // On self-hosted runners the workspace persists between runs, so a leftover
  // test.db may lack tables added in newer migrations.  The webServer processes
  // (defined in playwright.config.ts) start concurrently with globalSetup, and
  // the API server will crash if it reads a stale schema.
  const testDbPath = path.resolve(ISSUES_DIR, "test.db");
  for (const f of [testDbPath, `${testDbPath}-journal`, `${testDbPath}-wal`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // File doesn't exist — that's fine.
    }
  }

  const env = {
    ...process.env,
    DATABASE_URL: `file:${testDbPath}`,
  };

  console.log("Running prisma migrate deploy against test database...");
  execSync("npx prisma migrate deploy", { cwd: ISSUES_DIR, env, stdio: "inherit" });

  console.log("Seeding test database...");
  execSync("npx tsx prisma/seed-e2e.ts", { cwd: ISSUES_DIR, env, stdio: "inherit" });
}
