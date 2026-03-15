import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ISSUES_DIR = path.resolve(__dirname, "../../issues");

export default function globalSetup() {
  const env = {
    ...process.env,
    DATABASE_URL: "file:./test.db",
  };

  console.log("Running prisma migrate deploy against test database...");
  execSync("npx prisma migrate deploy", { cwd: ISSUES_DIR, env, stdio: "inherit" });

  console.log("Seeding test database...");
  execSync("npx tsx prisma/seed-e2e.ts", { cwd: ISSUES_DIR, env, stdio: "inherit" });
}
