import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

// Resolve paths relative to repo root (two levels up from issues-cli/)
const REPO_ROOT = resolve(__dirname, "../../../..");
const ISSUES_SERVICE_DIR = join(REPO_ROOT, "services", "issues");
const ISSUES_CLI_DIR = join(REPO_ROOT, "services", "issues-cli");

/**
 * Find a free port by briefly listening on port 0 and reading the assigned port.
 */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not determine port")));
      }
    });
    srv.on("error", reject);
  });
}

export interface TestServer {
  url: string;
  cleanup: () => void;
}

/**
 * Start the Apollo Server as a child process with a fresh SQLite database.
 * Waits for "Server ready" on stdout before resolving.
 */
export async function createTestServer(): Promise<TestServer> {
  const tmpDir = mkdtempSync(join(tmpdir(), "issues-e2e-"));
  const dbPath = join(tmpDir, "test.db");
  const databaseUrl = `file:${dbPath}`;
  const port = await getFreePort();

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: String(port),
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

  // Start the server as a child process
  const serverProcess = spawn("npx", ["tsx", join(ISSUES_SERVICE_DIR, "src", "index.ts")], {
    env,
    cwd: ISSUES_SERVICE_DIR,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const url = `http://localhost:${port}`;

  // Wait for "Server ready" in stdout
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server did not start within 15 seconds"));
    }, 15_000);

    let stderr = "";

    serverProcess.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text.includes("Server ready")) {
        clearTimeout(timeout);
        resolvePromise();
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

  return { url, cleanup };
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Run the issues CLI as a child process pointing at the given server URL.
 */
export function runCli(serverUrl: string, ...args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = execCliProcess(serverUrl, args);

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

function execCliProcess(serverUrl: string, args: string[]): ChildProcess {
  // Disable chalk colors and ora spinners for predictable output
  const env = {
    ...process.env,
    ISSUES_API_URL: serverUrl,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };

  return spawn(
    "npx",
    ["tsx", join(ISSUES_CLI_DIR, "src", "index.ts"), ...args],
    {
      env,
      cwd: ISSUES_CLI_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
}

export interface TestSuite {
  url: string;
  cleanup: () => void;
  cli: (...args: string[]) => Promise<CliResult>;
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
  const { url, cleanup } = await createTestServer();
  const cli = (...args: string[]) => runCli(url, ...args);
  return { url, cleanup, cli };
}
