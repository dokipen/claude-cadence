import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestSuite, type TestSuite } from "./helpers.js";

describe("Label Management", () => {
  let suite: TestSuite;

  beforeAll(async () => {
    suite = await setupTestSuite();
  });

  afterAll(() => {
    suite?.cleanup();
  });

  let createdLabelId: string;
  let ticketId: string;

  it("should list seeded labels", async () => {
    const result = await suite.cli("label", "list");
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("bug");
    expect(output).toContain("enhancement");
    expect(output).toContain("security");
  });

  it("should create a label", async () => {
    const result = await suite.cli("label", "create", "--name", "test-label", "--color", "#123456");
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Label created");
    expect(result.stdout).toContain("test-label");
    expect(result.stdout).toContain("#123456");

    const idMatch = result.stdout.match(/#(\S+)\s+test-label/);
    expect(idMatch).toBeTruthy();
    createdLabelId = idMatch![1];
  });

  it("should show newly created label in list", async () => {
    const result = await suite.cli("label", "list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("test-label");
  });

  it("should create a ticket for label operations", async () => {
    const result = await suite.cli("ticket", "create", "--title", "Label test ticket");
    expect(result.exitCode).toBe(0);

    const idMatch = result.stdout.match(/#(\S+)\s+Label test ticket/);
    expect(idMatch).toBeTruthy();
    ticketId = idMatch![1];
  });

  it("should add a label to a ticket", async () => {
    const result = await suite.cli("label", "add", ticketId, "--label", createdLabelId);
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Label added");
    expect(result.stdout).toContain("test-label");
  });

  it("should show label on ticket view", async () => {
    const result = await suite.cli("ticket", "view", ticketId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("test-label");
  });

  it("should remove a label from a ticket", async () => {
    const result = await suite.cli("label", "remove", ticketId, "--label", createdLabelId);
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Label removed");
  });

  it("should no longer show label on ticket view after removal", async () => {
    const result = await suite.cli("ticket", "view", ticketId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("test-label");
  });
});
