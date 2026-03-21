import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestSuite, type TestSuite, TEST_PROJECT_ID } from "./helpers.js";

describe("Priority and Estimation", () => {
  let suite: TestSuite;

  beforeAll(async () => {
    suite = await setupTestSuite();
  });

  afterAll(() => {
    suite?.cleanup();
  });

  let highestTicketId: string;
  let pointsTicketId: string;
  let bothTicketId: string;
  let updateTargetId: string;

  it("should create a ticket with HIGHEST priority", async () => {
    const result = await suite.cli(
      "ticket", "create",
      "--project", TEST_PROJECT_ID,
      "--title", "Critical bug",
      "--priority", "HIGHEST"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket created");
    expect(result.stdout).toContain("Critical bug");
    expect(output).toContain("HIGHEST");

    const idMatch = result.stdout.match(/#(\S+)\s+Critical bug/);
    expect(idMatch).toBeTruthy();
    highestTicketId = idMatch![1];
  });

  it("should create a ticket with story points", async () => {
    const result = await suite.cli(
      "ticket", "create",
      "--project", TEST_PROJECT_ID,
      "--title", "Sized task",
      "--points", "13"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket created");
    expect(result.stdout).toContain("Sized task");
    expect(output).toContain("13");

    const idMatch = result.stdout.match(/#(\S+)\s+Sized task/);
    expect(idMatch).toBeTruthy();
    pointsTicketId = idMatch![1];
  });

  it("should create a ticket with both priority and story points", async () => {
    const result = await suite.cli(
      "ticket", "create",
      "--project", TEST_PROJECT_ID,
      "--title", "Urgent epic",
      "--priority", "HIGH",
      "--points", "8"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket created");
    expect(result.stdout).toContain("Urgent epic");
    expect(output).toContain("HIGH");
    expect(output).toContain("8");

    const idMatch = result.stdout.match(/#(\S+)\s+Urgent epic/);
    expect(idMatch).toBeTruthy();
    bothTicketId = idMatch![1];
  });

  it("should update priority from default MEDIUM to HIGH", async () => {
    // Create a ticket with default priority
    const createResult = await suite.cli(
      "ticket", "create",
      "--project", TEST_PROJECT_ID,
      "--title", "Priority update target"
    );
    expect(createResult.exitCode).toBe(0);

    const createOutput = createResult.stdout + createResult.stderr;
    expect(createOutput).toContain("MEDIUM");

    const idMatch = createResult.stdout.match(/#(\S+)\s+Priority update target/);
    expect(idMatch).toBeTruthy();
    updateTargetId = idMatch![1];

    // Update to HIGH
    const updateResult = await suite.cli(
      "ticket", "update", updateTargetId,
      "--priority", "HIGH"
    );
    expect(updateResult.exitCode).toBe(0);

    const updateOutput = updateResult.stdout + updateResult.stderr;
    expect(updateOutput).toContain("Ticket updated");
    expect(updateOutput).toContain("HIGH");

    // Verify via view
    const viewResult = await suite.cli("ticket", "view", updateTargetId);
    const viewOutput = viewResult.stdout + viewResult.stderr;
    expect(viewOutput).toContain("HIGH");
  });

  it("should update story points", async () => {
    const updateResult = await suite.cli(
      "ticket", "update", updateTargetId,
      "--points", "3"
    );
    expect(updateResult.exitCode).toBe(0);

    const updateOutput = updateResult.stdout + updateResult.stderr;
    expect(updateOutput).toContain("Ticket updated");
    expect(updateOutput).toContain("3");

    // Verify via view
    const viewResult = await suite.cli("ticket", "view", updateTargetId);
    const viewOutput = viewResult.stdout + viewResult.stderr;
    expect(viewOutput).toContain("3");
  });

  it("should filter tickets by priority", async () => {
    // Filter for HIGHEST — should only find "Critical bug"
    const highestResult = await suite.cli("ticket", "list", "--priority", "HIGHEST");
    expect(highestResult.exitCode).toBe(0);
    expect(highestResult.stdout).toContain("Critical bug");
    expect(highestResult.stdout).not.toContain("Sized task");
    expect(highestResult.stdout).not.toContain("Urgent epic");

    // Filter for HIGH — should find "Urgent epic" and "Priority update target"
    const highResult = await suite.cli("ticket", "list", "--priority", "HIGH");
    expect(highResult.exitCode).toBe(0);
    expect(highResult.stdout).toContain("Urgent epic");
    expect(highResult.stdout).toContain("Priority update target");
    expect(highResult.stdout).not.toContain("Critical bug");
  });

  it("should create tickets with different priorities and verify filtering", async () => {
    // Create tickets with LOWEST and LOW priorities
    const lowResult = await suite.cli(
      "ticket", "create",
      "--project", TEST_PROJECT_ID,
      "--title", "Low priority task",
      "--priority", "LOW"
    );
    expect(lowResult.exitCode).toBe(0);
    const lowOutput = lowResult.stdout + lowResult.stderr;
    expect(lowOutput).toContain("LOW");

    const lowestResult = await suite.cli(
      "ticket", "create",
      "--project", TEST_PROJECT_ID,
      "--title", "Lowest priority task",
      "--priority", "LOWEST"
    );
    expect(lowestResult.exitCode).toBe(0);
    const lowestOutput = lowestResult.stdout + lowestResult.stderr;
    expect(lowestOutput).toContain("LOWEST");

    // Verify filtering for each level
    const lowFiltered = await suite.cli("ticket", "list", "--priority", "LOW");
    expect(lowFiltered.exitCode).toBe(0);
    expect(lowFiltered.stdout).toContain("Low priority task");
    expect(lowFiltered.stdout).not.toContain("Lowest priority task");

    const lowestFiltered = await suite.cli("ticket", "list", "--priority", "LOWEST");
    expect(lowestFiltered.exitCode).toBe(0);
    expect(lowestFiltered.stdout).toContain("Lowest priority task");
    expect(lowestFiltered.stdout).not.toContain("Low priority task");

    // MEDIUM filter should find "Sized task" (default priority)
    const mediumFiltered = await suite.cli("ticket", "list", "--priority", "MEDIUM");
    expect(mediumFiltered.exitCode).toBe(0);
    expect(mediumFiltered.stdout).toContain("Sized task");
    expect(mediumFiltered.stdout).not.toContain("Critical bug");
  });
});
