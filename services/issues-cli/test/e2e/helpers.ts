import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";

// Resolve paths relative to repo root (two levels up from issues-cli/)
const REPO_ROOT = resolve(__dirname, "../../../..");
const ISSUES_SERVICE_DIR = join(REPO_ROOT, "services", "issues");
const ISSUES_CLI_DIR = join(REPO_ROOT, "services", "issues-cli");

const TEST_JWT_SECRET = "test-secret";
export const TEST_USER_ID = "test-user-id-000";

export interface TestServer {
  url: string;
  authToken: string;
  cleanup: () => void;
}

/**
 * Start the Apollo Server as a child process with a fresh SQLite database.
 * Waits for "Server ready" on stdout before resolving.
 * Creates a test user and returns a valid auth token.
 */
export async function createTestServer(): Promise<TestServer> {
  const tmpDir = mkdtempSync(join(tmpdir(), "issues-e2e-"));
  const dbPath = join(tmpDir, "test.db");
  const databaseUrl = `file:${dbPath}`;

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: "0",
    JWT_SECRET: TEST_JWT_SECRET,
  };

  // Run Prisma migrations
  execSync("npx prisma migrate deploy", {
    cwd: ISSUES_SERVICE_DIR,
    env,
    stdio: "pipe",
  });

  // Run seed
  execSync("npx prisma db seed", {
    cwd: ISSUES_SERVICE_DIR,
    env,
    stdio: "pipe",
  });

  // Create a test user directly via SQL
  const sqlFile = join(tmpDir, "create-test-user.sql");
  const now = new Date().toISOString();
  writeFileSync(sqlFile, `INSERT INTO User (id, githubId, login, displayName, avatarUrl, createdAt, updatedAt) VALUES ('${TEST_USER_ID}', 12345, 'testuser', 'Test User', NULL, '${now}', '${now}');`);

  execSync(`npx prisma db execute --file ${sqlFile} --schema prisma/schema.prisma`, {
    cwd: ISSUES_SERVICE_DIR,
    env,
    stdio: "pipe",
  });

  // Sign a JWT for the test user (includes jti for revocation support)
  const jti = randomBytes(16).toString("hex");
  const authToken = jwt.sign({ userId: TEST_USER_ID, jti }, TEST_JWT_SECRET, { expiresIn: "1h" });

  // Start the server as a child process
  const serverProcess = spawn("npx", ["tsx", join(ISSUES_SERVICE_DIR, "src", "index.ts")], {
    env,
    cwd: ISSUES_SERVICE_DIR,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Wait for "Server ready at <url>" in stdout and extract the actual bound URL
  const url = await new Promise<string>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server did not start within 15 seconds"));
    }, 15_000);

    let stderr = "";

    serverProcess.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      const match = text.match(/Server ready at (http:\/\/localhost:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolvePromise(match[1]);
      }
    });

    serverProcess.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    serverProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Server process error: ${err.message}\nStderr: ${stderr}`));
    });

    serverProcess.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}\nStderr: ${stderr}`));
      }
    });
  });

  const cleanup = () => {
    try {
      serverProcess.kill("SIGTERM");
    } catch {
      // process may already be dead
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  };

  return { url, authToken, cleanup };
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Run the issues CLI as a child process pointing at the given server URL.
 * Optionally pass an auth token via ISSUES_AUTH_TOKEN env var.
 */
export function runCli(
  serverUrl: string,
  args: string[],
  authToken?: string,
  cwd?: string,
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = execCliProcess(serverUrl, args, { authToken, cwd });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });

    child.on("error", (err) => {
      resolve({ stdout, stderr: stderr + err.message, exitCode: 1 });
    });
  });
}

interface ExecCliOptions {
  authToken?: string;
  cwd?: string;
}

function execCliProcess(serverUrl: string, args: string[], optsOrAuthToken?: string | ExecCliOptions): ChildProcess {
  const opts: ExecCliOptions = typeof optsOrAuthToken === "string"
    ? { authToken: optsOrAuthToken }
    : optsOrAuthToken ?? {};

  // Disable chalk colors and ora spinners for predictable output
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ISSUES_API_URL: serverUrl,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };

  if (opts.authToken) {
    env.ISSUES_AUTH_TOKEN = opts.authToken;
  }

  return spawn(
    "npx",
    ["tsx", join(ISSUES_CLI_DIR, "src", "index.ts"), ...args],
    {
      env,
      cwd: opts.cwd ?? ISSUES_CLI_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
}

/**
 * Run the issues CLI with data written to stdin.
 */
export function runCliWithStdin(
  serverUrl: string,
  args: string[],
  stdinData: string,
  authToken?: string,
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = execCliProcess(serverUrl, args, authToken);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });

    child.on("error", (err) => {
      resolve({ stdout, stderr: stderr + err.message, exitCode: 1 });
    });

    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

export interface TestSuite {
  url: string;
  authToken: string;
  cleanup: () => void;
  cli: (...args: string[]) => Promise<CliResult>;
  cliInDir: (cwd: string, ...args: string[]) => Promise<CliResult>;
  unauthenticatedCli: (...args: string[]) => Promise<CliResult>;
  cliWithStdin: (stdinData: string, ...args: string[]) => Promise<CliResult>;
}

/**
 * Setup helper for use in beforeAll/afterAll.
 *
 * Usage:
 *   let suite: TestSuite;
 *   beforeAll(async () => { suite = await setupTestSuite(); });
 *   afterAll(() => suite.cleanup());
 */
export async function setupTestSuite(): Promise<TestSuite> {
  const { url, authToken, cleanup } = await createTestServer();
  const cli = (...args: string[]) => runCli(url, args, authToken);
  const cliInDir = (cwd: string, ...args: string[]) => runCli(url, args, authToken, cwd);
  const unauthenticatedCli = (...args: string[]) => runCli(url, args);
  const cliWithStdin = (stdinData: string, ...args: string[]) => runCliWithStdin(url, args, stdinData);
  return { url, authToken, cleanup, cli, cliInDir, unauthenticatedCli, cliWithStdin };
}
