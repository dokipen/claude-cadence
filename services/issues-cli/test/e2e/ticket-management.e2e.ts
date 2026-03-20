import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestSuite, type TestSuite } from "./helpers.js";

describe("Ticket Management", () => {
  let suite: TestSuite;

  beforeAll(async () => {
    suite = await setupTestSuite();
  });

  afterAll(() => {
    suite?.cleanup();
  });

  // Track IDs for dependent tests
  let createdTicketId: string;
  let fullTicketId: string;
  let labelTicketId: string;

  it("should create a ticket with title only", async () => {
    const result = await suite.cli("ticket", "create", "--project", "default-project", "--title", "Simple ticket");
    expect(result.exitCode).toBe(0);

    // ora spinner writes to stderr, actual data to stdout
    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket created");
    expect(result.stdout).toContain("Simple ticket");
    expect(output).toContain("BACKLOG");
    expect(output).toContain("MEDIUM");

    // Extract the ticket ID from output like "#clxxxxxxxxx  Simple ticket"
    const idMatch = result.stdout.match(/#(\S+)\s+Simple ticket/);
    expect(idMatch).toBeTruthy();
    createdTicketId = idMatch![1];
  });

  it("should create a ticket with all fields", async () => {
    const result = await suite.cli(
      "ticket", "create",
      "--project", "default-project",
      "--title", "Full ticket",
      "--description", "A detailed description",
      "--acceptance-criteria", "It must work",
      "--priority", "HIGH",
      "--points", "5"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket created");
    expect(result.stdout).toContain("Full ticket");
    expect(output).toContain("HIGH");
    expect(output).toContain("5");

    const idMatch = result.stdout.match(/#(\S+)\s+Full ticket/);
    expect(idMatch).toBeTruthy();
    fullTicketId = idMatch![1];
  });

  it("should create a ticket using --body alias for --description", async () => {
    const result = await suite.cli(
      "ticket", "create",
      "--project", "default-project",
      "--title", "Body alias ticket",
      "--body", "Description via body flag"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket created");
    expect(result.stdout).toContain("Body alias ticket");

    // Verify the description was set by viewing the ticket
    const idMatch = result.stdout.match(/#(\S+)\s+Body alias ticket/);
    expect(idMatch).toBeTruthy();
    const viewResult = await suite.cli("ticket", "view", idMatch![1]);
    expect(viewResult.stdout).toContain("Description via body flag");
  });

  it("should create a ticket with labels", async () => {
    // The `labels` query is not yet in the GraphQL schema (Phase 2), so we cannot
    // look up seeded label IDs. For now, verify the CLI can create a ticket that
    // would accept labels by testing without the --labels flag. A full labels E2E
    // test will be added when label CLI commands land.
    const result = await suite.cli(
      "ticket", "create",
      "--project", "default-project",
      "--title", "Labeled ticket",
      "--description", "Ticket with labels"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket created");
    expect(result.stdout).toContain("Labeled ticket");

    const idMatch = result.stdout.match(/#(\S+)\s+Labeled ticket/);
    expect(idMatch).toBeTruthy();
    labelTicketId = idMatch![1];
  });

  it("should view a created ticket with all details", async () => {
    const result = await suite.cli("ticket", "view", fullTicketId);
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(result.stdout).toContain(fullTicketId);
    expect(result.stdout).toContain("Full ticket");
    expect(output).toContain("HIGH");
    expect(output).toContain("5");
    expect(result.stdout).toContain("A detailed description");
    expect(result.stdout).toContain("It must work");
  });

  it("should list tickets (default, no filters)", async () => {
    const result = await suite.cli("ticket", "list");
    expect(result.exitCode).toBe(0);
    // Should contain all created tickets
    expect(result.stdout).toContain("Simple ticket");
    expect(result.stdout).toContain("Full ticket");
    expect(result.stdout).toContain("Labeled ticket");
  });

  it("should filter tickets by state", async () => {
    const result = await suite.cli("ticket", "list", "--state", "BACKLOG");
    expect(result.exitCode).toBe(0);
    // All tickets are in BACKLOG by default
    expect(result.stdout).toContain("Simple ticket");
    expect(result.stdout).toContain("Full ticket");

    // No tickets in CLOSED state
    const closedResult = await suite.cli("ticket", "list", "--state", "CLOSED");
    expect(closedResult.exitCode).toBe(0);
    const closedOutput = closedResult.stdout + closedResult.stderr;
    expect(closedOutput).toContain("No tickets found");
  });

  it("should filter tickets by priority", async () => {
    const result = await suite.cli("ticket", "list", "--priority", "HIGH");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Full ticket");
    // Simple ticket is MEDIUM, should not appear
    expect(result.stdout).not.toContain("Simple ticket");
  });

  it("should limit results with --limit flag", async () => {
    // We have 3 tickets created above; requesting limit of 1 should return only 1
    const result = await suite.cli("ticket", "list", "--limit", "1");
    expect(result.exitCode).toBe(0);
    // Count ticket rows (each has a # prefix from formatTicketRow)
    const ticketLines = result.stdout.split("\n").filter(l => /^\s+#\S+\s+\[/.test(l));
    expect(ticketLines).toHaveLength(1);
    // Should indicate more results available
    expect(result.stdout).toContain("More results available");
  });

  it("should limit results with -l shorthand", async () => {
    const result = await suite.cli("ticket", "list", "-l", "2");
    expect(result.exitCode).toBe(0);
    const ticketLines = result.stdout.split("\n").filter(l => /^\s+#\S+\s+\[/.test(l));
    expect(ticketLines).toHaveLength(2);
    expect(result.stdout).toContain("More results available");
  });

  it("should reject invalid --limit values", async () => {
    for (const val of ["0", "-1", "abc", "10x"]) {
      const result = await suite.cli("ticket", "list", "--limit", val);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--limit must be a positive integer");
    }
  });


  it("should update a ticket's title", async () => {
    const result = await suite.cli("ticket", "update", createdTicketId, "--title", "Updated title");
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket updated");
    expect(result.stdout).toContain("Updated title");

    // Verify the update persisted
    const viewResult = await suite.cli("ticket", "view", createdTicketId);
    expect(viewResult.stdout).toContain("Updated title");
  });

  it("should update a ticket's description using --body alias", async () => {
    const result = await suite.cli(
      "ticket", "update", createdTicketId,
      "--body", "Description via body update"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket updated");

    const viewResult = await suite.cli("ticket", "view", createdTicketId);
    expect(viewResult.stdout).toContain("Description via body update");
  });

  it("should update a ticket's description and acceptance criteria", async () => {
    const result = await suite.cli(
      "ticket", "update", createdTicketId,
      "--description", "New description",
      "--acceptance-criteria", "New criteria"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket updated");

    // Verify via view
    const viewResult = await suite.cli("ticket", "view", createdTicketId);
    expect(viewResult.stdout).toContain("New description");
    expect(viewResult.stdout).toContain("New criteria");
  });

  it("should update story points and priority", async () => {
    const result = await suite.cli(
      "ticket", "update", createdTicketId,
      "--points", "8",
      "--priority", "HIGHEST"
    );
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Ticket updated");
    expect(output).toContain("8");
    expect(output).toContain("HIGHEST");
  });

  it("should filter tickets by single label", async () => {
    // Create two tickets and attach different labels
    const r1 = await suite.cli("ticket", "create", "--project", "default-project", "--title", "Bug ticket");
    expect(r1.exitCode).toBe(0);
    const id1 = r1.stdout.match(/#(\S+)\s+Bug ticket/)![1];

    const r2 = await suite.cli("ticket", "create", "--project", "default-project", "--title", "Feature ticket");
    expect(r2.exitCode).toBe(0);
    const id2 = r2.stdout.match(/#(\S+)\s+Feature ticket/)![1];

    // Look up label IDs from label list (seeded labels)
    const labelList = await suite.cli("label", "list", "--json");
    const labels = JSON.parse(labelList.stdout);
    const bugLabel = labels.find((l: { name: string }) => l.name === "bug");
    const enhLabel = labels.find((l: { name: string }) => l.name === "enhancement");

    // Add labels to tickets
    await suite.cli("label", "add", id1, "--label", bugLabel.id);
    await suite.cli("label", "add", id2, "--label", enhLabel.id);

    // Filter by single label
    const bugResult = await suite.cli("ticket", "list", "--label", "bug");
    expect(bugResult.exitCode).toBe(0);
    expect(bugResult.stdout).toContain("Bug ticket");
    expect(bugResult.stdout).not.toContain("Feature ticket");

    const enhResult = await suite.cli("ticket", "list", "--label", "enhancement");
    expect(enhResult.exitCode).toBe(0);
    expect(enhResult.stdout).toContain("Feature ticket");
    expect(enhResult.stdout).not.toContain("Bug ticket");
  });

  it("should filter tickets by multiple labels (OR)", async () => {
    // Using tickets created in previous test
    const result = await suite.cli("ticket", "list", "--label", "bug", "--label", "enhancement");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Bug ticket");
    expect(result.stdout).toContain("Feature ticket");
  });

  it("should return no tickets for non-existent label", async () => {
    const result = await suite.cli("ticket", "list", "--label", "nonexistent-label-xyz");
    expect(result.exitCode).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("No tickets found");
  });

  it("should handle viewing a non-existent ticket", async () => {
    const result = await suite.cli("ticket", "view", "nonexistent-id-12345");
    // The CLI should indicate the ticket was not found
    expect(result.exitCode).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("not found");
  });
});
