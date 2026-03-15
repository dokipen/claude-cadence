import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestSuite, type TestSuite } from "./helpers.js";

describe("Project Name Resolution", () => {
  let suite: TestSuite;
  let testProjectId: string;

  beforeAll(async () => {
    suite = await setupTestSuite();

    // Create a project to test name resolution
    const result = await suite.cli(
      "project", "create",
      "--name", "My Test Project",
      "--repository", "org/my-test-repo"
    );
    const idMatch = result.stdout.match(/#(\S+)\s+My Test Project/);
    if (!idMatch) {
      throw new Error(`Failed to parse project ID from output.\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nexitCode: ${result.exitCode}`);
    }
    testProjectId = idMatch[1];
  });

  afterAll(() => {
    suite?.cleanup();
  });

  // --- project view by name ---

  it("should view a project by name", async () => {
    const result = await suite.cli("project", "view", "My Test Project");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("My Test Project");
    expect(result.stdout).toContain("org/my-test-repo");
  });

  it("should view a project by CUID", async () => {
    const result = await suite.cli("project", "view", testProjectId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("My Test Project");
  });

  it("should fall back to literal ID for non-CUID values", async () => {
    // "default-project" is a literal ID in seed data that doesn't match any project name.
    // When name lookup fails, it falls back to treating the value as a literal ID.
    const result = await suite.cli("project", "view", "default-project");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Default");
  });

  it("should error for a non-existent project name", async () => {
    const result = await suite.cli("project", "view", "Nonexistent Project");
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Project not found");
  });

  // --- project update by name ---

  it("should update a project by name", async () => {
    const result = await suite.cli(
      "project", "update", "My Test Project",
      "--repository", "org/updated-repo"
    );
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Project updated");
    expect(result.stdout).toContain("org/updated-repo");
  });

  // --- ticket create with project name ---

  it("should create a ticket using project name", async () => {
    const result = await suite.cli(
      "ticket", "create",
      "--project", "My Test Project",
      "--title", "Ticket via project name"
    );
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket created");
    expect(result.stdout).toContain("Ticket via project name");
  });

  // --- ticket view by number with project name ---

  it("should view a ticket by number using project name", async () => {
    // First create a ticket so we have a known number
    const createResult = await suite.cli(
      "ticket", "create",
      "--project", "My Test Project",
      "--title", "Numbered ticket test"
    );
    expect(createResult.exitCode).toBe(0);

    // The ticket number should be in the output
    const numberMatch = createResult.stdout.match(/Number:\s+#(\d+)/);
    expect(numberMatch).toBeTruthy();
    const ticketNumber = numberMatch![1];

    // View by number with project name
    const viewResult = await suite.cli(
      "ticket", "view", ticketNumber,
      "--project", "My Test Project"
    );
    expect(viewResult.exitCode).toBe(0);
    expect(viewResult.stdout).toContain("Numbered ticket test");
  });

  // --- ticket list with project name ---

  it("should list tickets filtered by project name", async () => {
    // Create a ticket in the default project for comparison
    await suite.cli(
      "ticket", "create",
      "--project", "default-project",
      "--title", "Default project ticket for name test"
    );

    // List with project name filter
    const result = await suite.cli("ticket", "list", "--project", "My Test Project");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Ticket via project name");
    expect(result.stdout).not.toContain("Default project ticket for name test");
  });

  // --- backward compatibility: CUID still works ---

  it("should create a ticket using project CUID (backward compatible)", async () => {
    const result = await suite.cli(
      "ticket", "create",
      "--project", testProjectId,
      "--title", "Ticket via CUID"
    );
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket created");
  });

  // --- error: non-existent project name in ticket create ---

  it("should error when creating ticket with non-existent project name", async () => {
    const result = await suite.cli(
      "ticket", "create",
      "--project", "Nonexistent Project",
      "--title", "Should fail"
    );
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Project not found");
  });
});
