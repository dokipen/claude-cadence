import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestSuite, type TestSuite, TEST_PROJECT_ID, TEST_PROJECT_NAME, TEST_PROJECT_REPO } from "./helpers.js";

describe("Project Management", () => {
  let suite: TestSuite;

  beforeAll(async () => {
    suite = await setupTestSuite();
  });

  afterAll(() => {
    suite?.cleanup();
  });

  let createdProjectId: string;

  it("should list the seeded test project", async () => {
    const result = await suite.cli("project", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(TEST_PROJECT_NAME);
    expect(result.stdout).toContain(TEST_PROJECT_REPO);
  });

  it("should view the test project", async () => {
    const result = await suite.cli("project", "view", TEST_PROJECT_ID);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(TEST_PROJECT_NAME);
    expect(result.stdout).toContain(TEST_PROJECT_REPO);
  });

  it("should create a new project", async () => {
    const result = await suite.cli(
      "project", "create",
      "--name", "Test Project",
      "--repository", "org/test-repo"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Project created");
    expect(result.stdout).toContain("Test Project");
    expect(result.stdout).toContain("org/test-repo");

    const idMatch = result.stdout.match(/#(\S+)\s+Test Project/);
    expect(idMatch).toBeTruthy();
    createdProjectId = idMatch![1];
  });

  it("should show newly created project in list", async () => {
    const result = await suite.cli("project", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Test Project");
    expect(result.stdout).toContain("org/test-repo");
  });

  it("should view the created project", async () => {
    const result = await suite.cli("project", "view", createdProjectId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Test Project");
    expect(result.stdout).toContain("org/test-repo");
  });

  it("should update a project name", async () => {
    const result = await suite.cli(
      "project", "update", createdProjectId,
      "--name", "Updated Project"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Project updated");
    expect(result.stdout).toContain("Updated Project");

    // Verify via view
    const viewResult = await suite.cli("project", "view", createdProjectId);
    expect(viewResult.stdout).toContain("Updated Project");
  });

  it("should update a project repository", async () => {
    const result = await suite.cli(
      "project", "update", createdProjectId,
      "--repository", "org/updated-repo"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Project updated");
    expect(result.stdout).toContain("org/updated-repo");
  });

  it("should handle viewing a non-existent project", async () => {
    const result = await suite.cli("project", "view", "nonexistent-id-12345");
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("not found");
  });

  it("should create a ticket associated with a project", async () => {
    const result = await suite.cli(
      "ticket", "create",
      "--project", createdProjectId,
      "--title", "Project ticket"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket created");
    expect(result.stdout).toContain("Project ticket");

    const idMatch = result.stdout.match(/#(\S+)\s+Project ticket/);
    expect(idMatch).toBeTruthy();
    const ticketId = idMatch![1];

    // Verify project association via ticket view
    const viewResult = await suite.cli("ticket", "view", ticketId);
    expect(viewResult.stdout).toContain("Updated Project");
  });

  it("should filter tickets by project", async () => {
    // Create a ticket in the test fixture project
    await suite.cli(
      "ticket", "create",
      "--project", TEST_PROJECT_ID,
      "--title", "Fixture project ticket"
    );

    // Filter by the created project — should only show "Project ticket"
    const result = await suite.cli("ticket", "list", "--project", createdProjectId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project ticket");
    expect(result.stdout).not.toContain("Fixture project ticket");

    // Filter by test fixture project — should show "Fixture project ticket" but not "Project ticket"
    const fixtureResult = await suite.cli("ticket", "list", "--project", TEST_PROJECT_ID);
    expect(fixtureResult.exitCode).toBe(0);
    expect(fixtureResult.stdout).toContain("Fixture project ticket");
    expect(fixtureResult.stdout).not.toContain("Project ticket");
  });

  it("should reject creating a ticket with non-existent project", async () => {
    const result = await suite.cli(
      "ticket", "create",
      "--project", "nonexistent-project-id",
      "--title", "Should fail"
    );
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Project not found");
  });

  it("should reject creating a project with duplicate name", async () => {
    const result = await suite.cli(
      "project", "create",
      "--name", TEST_PROJECT_NAME,
      "--repository", "org/another-repo"
    );
    expect(result.exitCode).not.toBe(0);
  });

  it("should reject creating a project with duplicate repository", async () => {
    const result = await suite.cli(
      "project", "create",
      "--name", "Another Project",
      "--repository", TEST_PROJECT_REPO
    );
    expect(result.exitCode).not.toBe(0);
  });

  it("should handle updating a non-existent project", async () => {
    const result = await suite.cli(
      "project", "update", "nonexistent-id-12345",
      "--name", "Should fail"
    );
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Project not found");
  });

  it("should produce clean stderr (no spinner text) when --json is used with project list", async () => {
    const result = await suite.cli("project", "list", "--json");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});
