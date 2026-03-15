import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestSuite, type TestSuite } from "./helpers.js";

describe("Workflow States", () => {
  let suite: TestSuite;

  beforeAll(async () => {
    suite = await setupTestSuite();
  });

  afterAll(() => {
    suite?.cleanup();
  });

  let ticketId: string;

  it("should create a ticket in BACKLOG state", async () => {
    const result = await suite.cli("ticket", "create", "--project", "default-project", "--title", "FSM test ticket");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("BACKLOG");
    const idMatch = result.stdout.match(/#(\S+)\s+FSM test ticket/);
    expect(idMatch).toBeTruthy();
    ticketId = idMatch![1];
  });

  it("should transition BACKLOG → REFINED", async () => {
    const result = await suite.cli("ticket", "transition", ticketId, "--to", "REFINED");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket transitioned");
    expect(output).toContain("REFINED");
  });

  it("should transition REFINED → IN_PROGRESS", async () => {
    const result = await suite.cli("ticket", "transition", ticketId, "--to", "IN_PROGRESS");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket transitioned");
    expect(output).toContain("IN_PROGRESS");
  });

  it("should transition IN_PROGRESS → CLOSED", async () => {
    const result = await suite.cli("ticket", "transition", ticketId, "--to", "CLOSED");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket transitioned");
    expect(output).toContain("CLOSED");
  });

  it("should transition CLOSED → BACKLOG (reopen)", async () => {
    const result = await suite.cli("ticket", "transition", ticketId, "--to", "BACKLOG");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket transitioned");
    expect(output).toContain("BACKLOG");
  });

  it("should transition BACKLOG → REFINED → BACKLOG (demotion)", async () => {
    // First go to REFINED
    let result = await suite.cli("ticket", "transition", ticketId, "--to", "REFINED");
    expect(result.exitCode).toBe(0);

    // Then demote back to BACKLOG
    result = await suite.cli("ticket", "transition", ticketId, "--to", "BACKLOG");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("BACKLOG");
  });

  it("should transition IN_PROGRESS → REFINED (return to ready)", async () => {
    // Setup: BACKLOG → REFINED → IN_PROGRESS
    await suite.cli("ticket", "transition", ticketId, "--to", "REFINED");
    await suite.cli("ticket", "transition", ticketId, "--to", "IN_PROGRESS");

    // Return to REFINED
    const result = await suite.cli("ticket", "transition", ticketId, "--to", "REFINED");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("REFINED");
  });

  it("should allow transition BACKLOG → CLOSED", async () => {
    // Reset to BACKLOG
    await suite.cli("ticket", "transition", ticketId, "--to", "BACKLOG");

    const result = await suite.cli("ticket", "transition", ticketId, "--to", "CLOSED");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("CLOSED");
  });

  it("should reject invalid transition BACKLOG → IN_PROGRESS", async () => {
    const result = await suite.cli("ticket", "transition", ticketId, "--to", "IN_PROGRESS");
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Invalid transition");
  });

  it("should reject same-state transition", async () => {
    const result = await suite.cli("ticket", "transition", ticketId, "--to", "BACKLOG");
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Invalid transition");
  });

  it("should reject transition for non-existent ticket", async () => {
    const result = await suite.cli("ticket", "transition", "nonexistent-id", "--to", "REFINED");
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("not found");
  });

  it("should block transition to IN_PROGRESS when ticket has unresolved blockers", async () => {
    // Create blocker ticket
    const blockerResult = await suite.cli("ticket", "create", "--project", "default-project", "--title", "Blocker ticket");
    const blockerIdMatch = blockerResult.stdout.match(/#(\S+)\s+Blocker ticket/);
    const blockerId = blockerIdMatch![1];

    // Move main ticket to REFINED
    await suite.cli("ticket", "transition", ticketId, "--to", "REFINED");

    // Add block relation
    await suite.cli("block", "add", "--blocker", blockerId, "--blocked", ticketId);

    // Try to transition to IN_PROGRESS — should fail
    const result = await suite.cli("ticket", "transition", ticketId, "--to", "IN_PROGRESS");
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("unresolved blocker");
  });

  it("should allow transition to IN_PROGRESS after all blockers are CLOSED", async () => {
    // Create a fresh pair of tickets
    const blockerResult = await suite.cli("ticket", "create", "--project", "default-project", "--title", "Resolved blocker");
    const blockerIdMatch = blockerResult.stdout.match(/#(\S+)\s+Resolved blocker/);
    const blockerId = blockerIdMatch![1];

    const blockedResult = await suite.cli("ticket", "create", "--project", "default-project", "--title", "Unblocked ticket");
    const blockedIdMatch = blockedResult.stdout.match(/#(\S+)\s+Unblocked ticket/);
    const blockedId = blockedIdMatch![1];

    // Add block relation
    await suite.cli("block", "add", "--blocker", blockerId, "--blocked", blockedId);

    // Move blocked ticket to REFINED
    await suite.cli("ticket", "transition", blockedId, "--to", "REFINED");

    // Close the blocker: BACKLOG → REFINED → IN_PROGRESS → CLOSED
    await suite.cli("ticket", "transition", blockerId, "--to", "REFINED");
    await suite.cli("ticket", "transition", blockerId, "--to", "IN_PROGRESS");
    await suite.cli("ticket", "transition", blockerId, "--to", "CLOSED");

    // Now transition to IN_PROGRESS should succeed
    const result = await suite.cli("ticket", "transition", blockedId, "--to", "IN_PROGRESS");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket transitioned");
    expect(output).toContain("IN_PROGRESS");
  });
});
