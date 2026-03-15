import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestSuite, setupTestSuite } from "./helpers.js";

describe("Project inference from git origin", () => {
  let suite: TestSuite;
  let projectId: string;
  let gitDir: string;
  let nonGitDir: string;

  beforeAll(async () => {
    suite = await setupTestSuite();

    // Create a project with a known repository
    const result = await suite.cli(
      "project", "create",
      "--name", "Inference Test",
      "--repository", "test-org/test-repo",
    );
    const idMatch = (result.stdout + result.stderr).match(/#(c\w+)/);
    projectId = idMatch![1];

    // Create a temp directory with a git repo that has a matching origin
    gitDir = mkdtempSync(join(tmpdir(), "git-inference-"));
    execSync("git init", { cwd: gitDir, stdio: "pipe" });
    execSync("git remote add origin https://github.com/test-org/test-repo.git", {
      cwd: gitDir,
      stdio: "pipe",
    });

    // Create a temp directory without git
    nonGitDir = mkdtempSync(join(tmpdir(), "no-git-inference-"));
  });

  afterAll(() => {
    suite?.cleanup();
    try { rmSync(gitDir, { recursive: true, force: true }); } catch {}
    try { rmSync(nonGitDir, { recursive: true, force: true }); } catch {}
  });

  it("should infer project for ticket create when run from a git repo", async () => {
    const result = await suite.cliInDir(
      gitDir,
      "ticket", "create",
      "--title", "Inferred project ticket",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain("Ticket created");
  });

  it("should infer project for ticket view by number", async () => {
    // First create a ticket with explicit project
    const createResult = await suite.cli(
      "ticket", "create",
      "--title", "View inference test",
      "--project", projectId,
    );
    const numberMatch = (createResult.stdout + createResult.stderr).match(/Number: #(\d+)/);
    const ticketNumber = numberMatch![1];

    // View by number without --project from git dir
    const viewResult = await suite.cliInDir(
      gitDir,
      "ticket", "view", ticketNumber,
    );
    expect(viewResult.exitCode).toBe(0);
    expect(viewResult.stdout + viewResult.stderr).toContain("View inference test");
  });

  it("should infer project for ticket list", async () => {
    const result = await suite.cliInDir(
      gitDir,
      "ticket", "list",
    );
    expect(result.exitCode).toBe(0);
    // Should show tickets from the inferred project
    expect(result.stdout + result.stderr).not.toContain("No tickets found");
  });

  it("should prefer explicit --project over inference", async () => {
    const result = await suite.cliInDir(
      gitDir,
      "ticket", "create",
      "--title", "Explicit project ticket",
      "--project", projectId,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain("Ticket created");
  });

  it("should fail ticket create when no git origin and no --project", async () => {
    const result = await suite.cliInDir(
      nonGitDir,
      "ticket", "create",
      "--title", "Should fail",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("no git remote origin found");
  });

  it("should work with SSH-style remote URLs", async () => {
    const sshDir = mkdtempSync(join(tmpdir(), "git-ssh-inference-"));
    try {
      execSync("git init", { cwd: sshDir, stdio: "pipe" });
      execSync("git remote add origin git@github.com:test-org/test-repo.git", {
        cwd: sshDir,
        stdio: "pipe",
      });

      const result = await suite.cliInDir(
        sshDir,
        "ticket", "create",
        "--title", "SSH origin ticket",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout + result.stderr).toContain("Ticket created");
    } finally {
      rmSync(sshDir, { recursive: true, force: true });
    }
  });

  it("should error when repo doesn't match any project", async () => {
    const unmatchedDir = mkdtempSync(join(tmpdir(), "git-unmatched-"));
    try {
      execSync("git init", { cwd: unmatchedDir, stdio: "pipe" });
      execSync("git remote add origin https://github.com/unknown-org/unknown-repo.git", {
        cwd: unmatchedDir,
        stdio: "pipe",
      });

      const result = await suite.cliInDir(
        unmatchedDir,
        "ticket", "create",
        "--title", "Should fail",
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("No project found matching repository");
    } finally {
      rmSync(unmatchedDir, { recursive: true, force: true });
    }
  });
});
