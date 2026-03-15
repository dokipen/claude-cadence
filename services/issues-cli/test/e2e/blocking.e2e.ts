import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestSuite, type TestSuite } from "./helpers.js";

describe("Blocking", () => {
  let suite: TestSuite;

  beforeAll(async () => {
    suite = await setupTestSuite();
  });

  afterAll(() => {
    suite?.cleanup();
  });

  let ticketAId: string;
  let ticketBId: string;

  it("should create two tickets for blocking tests", async () => {
    const resultA = await suite.cli("ticket", "create", "--title", "Ticket A");
    expect(resultA.exitCode).toBe(0);
    const idMatchA = resultA.stdout.match(/#(\S+)\s+Ticket A/);
    expect(idMatchA).toBeTruthy();
    ticketAId = idMatchA![1];

    const resultB = await suite.cli("ticket", "create", "--title", "Ticket B");
    expect(resultB.exitCode).toBe(0);
    const idMatchB = resultB.stdout.match(/#(\S+)\s+Ticket B/);
    expect(idMatchB).toBeTruthy();
    ticketBId = idMatchB![1];
  });

  it("should add a block relation (A blocks B)", async () => {
    const result = await suite.cli("block", "add", "--blocker", ticketAId, "--blocked", ticketBId);
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Block relation added");
    expect(output).toContain("Ticket B");
  });

  it("should show blocking info in ticket view", async () => {
    const result = await suite.cli("ticket", "view", ticketBId);
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Blocked By");
    expect(output).toContain("Ticket A");
  });

  it("should show blocks info on the blocker ticket", async () => {
    const result = await suite.cli("ticket", "view", ticketAId);
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Blocks");
    expect(output).toContain("Ticket B");
  });

  it("should reject self-blocking", async () => {
    const result = await suite.cli("block", "add", "--blocker", ticketAId, "--blocked", ticketAId);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("cannot block itself");
  });

  it("should handle duplicate block relation idempotently", async () => {
    const result = await suite.cli("block", "add", "--blocker", ticketAId, "--blocked", ticketBId);
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Block relation added");
  });

  it("should remove a block relation", async () => {
    const result = await suite.cli("block", "remove", "--blocker", ticketAId, "--blocked", ticketBId);
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Block relation removed");
    expect(output).toContain("No longer blocked");
  });

  it("should not show blocking info after removal", async () => {
    const result = await suite.cli("ticket", "view", ticketBId);
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain("Blocked By");
  });

  it("should reject removing a non-existent block relation", async () => {
    const result = await suite.cli("block", "remove", "--blocker", ticketAId, "--blocked", ticketBId);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Block relation not found");
  });

  it("should filter blocked tickets with --blocked flag", async () => {
    // Re-add the block relation
    await suite.cli("block", "add", "--blocker", ticketAId, "--blocked", ticketBId);

    const result = await suite.cli("ticket", "list", "--blocked");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket B");
    expect(output).not.toContain("Ticket A");
  });

  it("should prevent blocked ticket from transitioning to IN_PROGRESS", async () => {
    // Move ticket B to REFINED first
    await suite.cli("ticket", "transition", ticketBId, "--to", "REFINED");

    // Try to move to IN_PROGRESS — should fail because A blocks B and A is not CLOSED
    const result = await suite.cli("ticket", "transition", ticketBId, "--to", "IN_PROGRESS");
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("unresolved blocker");
  });

  it("should allow transition after blocker is closed", async () => {
    // Close ticket A: BACKLOG → REFINED → IN_PROGRESS → CLOSED
    await suite.cli("ticket", "transition", ticketAId, "--to", "REFINED");
    await suite.cli("ticket", "transition", ticketAId, "--to", "IN_PROGRESS");
    await suite.cli("ticket", "transition", ticketAId, "--to", "CLOSED");

    // Now B should be able to transition to IN_PROGRESS
    const result = await suite.cli("ticket", "transition", ticketBId, "--to", "IN_PROGRESS");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket transitioned");
    expect(output).toContain("IN_PROGRESS");
  });
});
