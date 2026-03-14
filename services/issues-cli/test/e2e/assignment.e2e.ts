import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GraphQLClient, gql } from "graphql-request";
import { setupTestSuite, type TestSuite } from "./helpers.js";

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

  it("should create a test user and ticket via GraphQL", async () => {
    const client = new GraphQLClient(suite.url);

    const CREATE_USER = gql`
      mutation CreateUser($githubId: Int!, $login: String!, $displayName: String!) {
        createUser(githubId: $githubId, login: $login, displayName: $displayName) {
          id
          login
          displayName
        }
      }
    `;

    const userData = await client.request<{
      createUser: { id: string; login: string; displayName: string };
    }>(CREATE_USER, { githubId: 12345, login: "testuser", displayName: "Test User" });

    userId = userData.createUser.id;
    expect(userId).toBeTruthy();

    const result = await suite.cli("ticket", "create", "--title", "Assignment test ticket");
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
