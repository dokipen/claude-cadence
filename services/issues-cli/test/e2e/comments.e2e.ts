import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GraphQLClient, gql } from "graphql-request";
import { setupTestSuite, type TestSuite } from "./helpers.js";

describe("Comment Management", () => {
  let suite: TestSuite;
  let ticketId: string;
  let commentId: string;

  beforeAll(async () => {
    suite = await setupTestSuite();

    // Test user is created by the test helper (testuser)

    // Create a ticket for comment operations
    const result = await suite.cli("ticket", "create", "--title", "Comment test ticket");
    const idMatch = result.stdout.match(/#(\S+)\s+Comment test ticket/);
    ticketId = idMatch![1];
  });

  afterAll(() => {
    suite?.cleanup();
  });

  it("should add a comment to a ticket", async () => {
    const result = await suite.cli("comment", "add", ticketId, "--body", "First comment");
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Comment added");
    expect(result.stdout).toContain("@testuser");
    expect(result.stdout).toContain("First comment");
  });

  it("should show comment on ticket view", async () => {
    const result = await suite.cli("ticket", "view", ticketId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Comments (1)");
    expect(result.stdout).toContain("@testuser");
    expect(result.stdout).toContain("First comment");
  });

  it("should add a second comment and extract its ID", async () => {
    const result = await suite.cli("comment", "add", ticketId, "--body", "Second comment");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Second comment");

    // View ticket to see both comments and get the second comment's ID via GraphQL
    const client = new GraphQLClient(suite.url, {
      headers: { Authorization: `Bearer ${suite.authToken}` },
    });
    const data = await client.request<{
      ticket: { comments: { id: string; body: string }[] };
    }>(
      gql`
        query ($id: ID!) {
          ticket(id: $id) {
            comments {
              id
              body
            }
          }
        }
      `,
      { id: ticketId }
    );

    const second = data.ticket.comments.find((c) => c.body === "Second comment");
    expect(second).toBeTruthy();
    commentId = second!.id;
  });

  it("should edit a comment", async () => {
    const result = await suite.cli("comment", "edit", commentId, "--body", "Updated comment");
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Comment updated");
    expect(result.stdout).toContain("Updated comment");
  });

  it("should show updated comment on ticket view", async () => {
    const result = await suite.cli("ticket", "view", ticketId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Updated comment");
    expect(result.stdout).not.toContain("Second comment");
  });

  it("should delete a comment", async () => {
    const result = await suite.cli("comment", "delete", commentId);
    expect(result.exitCode).toBe(0);

    const output = result.stdout + result.stderr;
    expect(output).toContain("Comment deleted");
  });

  it("should show only one comment after deletion", async () => {
    const result = await suite.cli("ticket", "view", ticketId);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Comments (1)");
    expect(result.stdout).toContain("First comment");
    expect(result.stdout).not.toContain("Updated comment");
  });
});
