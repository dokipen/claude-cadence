import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestSuite, type TestSuite } from "./helpers.js";

describe("Project Management", () => {
  let suite: TestSuite;

  beforeAll(async () => {
    suite = await setupTestSuite();
  });

  afterAll(() => {
    suite?.cleanup();
  });

  let createdProjectId: string;

  it("should list the seeded default project", async () => {
    const result = await suite.cli("project", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Default");
    expect(result.stdout).toContain("default/repository");
  });

  it("should view the default project", async () => {
    const result = await suite.cli("project", "view", "default-project");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Default");
    expect(result.stdout).toContain("default/repository");
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
    // Create a ticket in the default project
    await suite.cli(
      "ticket", "create",
      "--project", "default-project",
      "--title", "Default project ticket"
    );

    // Filter by the created project — should only show "Project ticket"
    const result = await suite.cli("ticket", "list", "--project", createdProjectId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project ticket");
    expect(result.stdout).not.toContain("Default project ticket");

    // Filter by default project — should show "Default project ticket" but not "Project ticket"
    const defaultResult = await suite.cli("ticket", "list", "--project", "default-project");
    expect(defaultResult.exitCode).toBe(0);
    expect(defaultResult.stdout).toContain("Default project ticket");
    expect(defaultResult.stdout).not.toContain("Project ticket");
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
});
