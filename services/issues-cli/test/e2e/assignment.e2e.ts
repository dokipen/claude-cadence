import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestSuite, type TestSuite, TEST_USER_ID, TEST_PROJECT_ID } from "./helpers.js";

describe("Assignment Management", () => {
  let suite: TestSuite;
  let userId: string;
  let ticketId: string;

  beforeAll(async () => {
    suite = await setupTestSuite();
  });

  afterAll(() => {
    suite?.cleanup();
  });

  it("should create a ticket for assignment tests", async () => {
    // Use the test user created by the test helper
    userId = TEST_USER_ID;
    expect(userId).toBeTruthy();

    const result = await suite.cli("ticket", "create", "--project", TEST_PROJECT_ID, "--title", "Assignment test ticket");
    expect(result.exitCode).toBe(0);

    const idMatch = result.stdout.match(/#(\S+)\s+Assignment test ticket/);
    expect(idMatch).toBeTruthy();
    ticketId = idMatch![1];
  });

  it("should assign a ticket to a user", async () => {
    const result = await suite.cli("assign", ticketId, "--user", userId);
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket assigned");
    expect(result.stdout).toContain("@testuser");
  });

  it("should show assignee on ticket view", async () => {
    const result = await suite.cli("ticket", "view", ticketId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("@testuser");
    expect(result.stdout).toContain("Test User");
  });

  it("should unassign a ticket", async () => {
    const result = await suite.cli("unassign", ticketId);
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket unassigned");
  });

  it("should no longer show assignee on ticket view after unassign", async () => {
    const result = await suite.cli("ticket", "view", ticketId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("@testuser");
  });

  it("should reassign a ticket to the same user", async () => {
    const assignResult = await suite.cli("assign", ticketId, "--user", userId);
    expect(assignResult.exitCode).toBe(0);

    const output = assignResult.stdout + assignResult.stderr;
    expect(output).toContain("Ticket assigned");
    expect(assignResult.stdout).toContain("@testuser");
  });
});
