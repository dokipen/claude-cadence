import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");
const ISSUES_SERVICE_DIR = join(REPO_ROOT, "services", "issues");

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const templateDir = mkdtempSync(join(tmpdir(), "issues-e2e-template-"));
  const templateDbPath = join(templateDir, "template.db");
  const databaseUrl = `file:${templateDbPath}`;

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
  };

  // Run migrations once for all test files
  execSync("npx prisma migrate deploy", {
    cwd: ISSUES_SERVICE_DIR,
    env,
    stdio: "pipe",
  });

  // Seed the template DB once
  execSync("npx prisma db seed", {
    cwd: ISSUES_SERVICE_DIR,
    env,
    stdio: "pipe",
  });

  provide("templateDbPath", templateDbPath);

  return () => {
    try {
      rmSync(templateDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  };
}
