import { describe, it, expect, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

const { ticketResolvers } = await import("./ticket.js");

function makeMockContext(findManyResult: unknown[] = []) {
  return {
    prisma: {
      ticket: {
        findMany: vi.fn().mockResolvedValue(findManyResult),
      },
    } as any,
    loaders: {} as any,
    currentUser: null,
  };
}

const { tickets } = ticketResolvers.Query;

// ---------------------------------------------------------------------------
// Reproduction test — the bug: state + labelName produces a valid where clause
// with both properties present. Before the fix this combination caused a 502.
// ---------------------------------------------------------------------------
describe("tickets filter — reproduction: state + labelName combined (issue #70)", () => {
  it("produces a where clause with both state and labels when state and labelName are provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { state: "IN_PROGRESS", labelName: "bug" }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.state).toBe("IN_PROGRESS");
    expect(call.where.labels).toEqual({
      some: { label: { name: "bug" } },
    });
  });
});

// ---------------------------------------------------------------------------
// Individual filter tests
// ---------------------------------------------------------------------------
describe("tickets filter — individual filters", () => {
  it("sets where.state when state arg is provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { state: "BACKLOG" }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.state).toBe("BACKLOG");
    expect(call.where.labels).toBeUndefined();
    expect(call.where.priority).toBeUndefined();
    expect(call.where.assignee).toBeUndefined();
    expect(call.where.projectId).toBeUndefined();
  });

  it("sets where.labels when labelName arg is provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { labelName: "feature" }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.labels).toEqual({
      some: { label: { name: "feature" } },
    });
    expect(call.where.state).toBeUndefined();
  });

  it("sets where.priority when priority arg is provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { priority: "HIGH" }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.priority).toBe("HIGH");
    expect(call.where.state).toBeUndefined();
    expect(call.where.labels).toBeUndefined();
  });

  it("sets where.assignee.login when assigneeLogin arg is provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { assigneeLogin: "alice" }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.assignee).toEqual({ login: "alice" });
    expect(call.where.state).toBeUndefined();
    expect(call.where.labels).toBeUndefined();
  });

  it("sets where.projectId when projectId arg is provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { projectId: "proj-abc" }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.projectId).toBe("proj-abc");
    expect(call.where.state).toBeUndefined();
    expect(call.where.labels).toBeUndefined();
  });

  it("does not set any filter properties when no args are provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, {}, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.state).toBeUndefined();
    expect(call.where.labels).toBeUndefined();
    expect(call.where.priority).toBeUndefined();
    expect(call.where.assignee).toBeUndefined();
    expect(call.where.projectId).toBeUndefined();
    expect(call.where.blockedBy).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Combined filter tests
// ---------------------------------------------------------------------------
describe("tickets filter — combined filters", () => {
  it("sets both where.state and where.labels when state + labelName are provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { state: "REFINED", labelName: "enhancement" }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.state).toBe("REFINED");
    expect(call.where.labels).toEqual({
      some: { label: { name: "enhancement" } },
    });
  });

  it("sets where.state, where.labels, and where.priority when all three are provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(
      undefined,
      { state: "IN_PROGRESS", labelName: "bug", priority: "HIGHEST" },
      ctx
    );

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.state).toBe("IN_PROGRESS");
    expect(call.where.labels).toEqual({
      some: { label: { name: "bug" } },
    });
    expect(call.where.priority).toBe("HIGHEST");
  });

  it("sets where.state, where.labels, and where.projectId when all three are provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(
      undefined,
      { state: "CLOSED", labelName: "chore", projectId: "proj-xyz" },
      ctx
    );

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.state).toBe("CLOSED");
    expect(call.where.labels).toEqual({
      some: { label: { name: "chore" } },
    });
    expect(call.where.projectId).toBe("proj-xyz");
  });
});

// ---------------------------------------------------------------------------
// Sort order — CLOSED tickets should be sorted newest-first (issue #95)
// ---------------------------------------------------------------------------
describe("tickets — sort order by state", () => {
  it("uses updatedAt desc for CLOSED state", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { state: "CLOSED" }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ updatedAt: "desc" });
  });

  it("uses createdAt asc for non-CLOSED states", async () => {
    for (const state of ["BACKLOG", "REFINED", "IN_PROGRESS"]) {
      const ctx = makeMockContext([]);
      await tickets(undefined, { state }, ctx);

      const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: "asc" });
    }
  });

  it("uses createdAt asc when no state is specified", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, {}, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: "asc" });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
describe("tickets — error handling", () => {
  it("wraps Prisma errors in a GraphQLError without leaking details", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findMany: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: null,
    };

    await expect(
      tickets(undefined, { state: "BACKLOG", labelName: "bug" }, ctx)
    ).rejects.toThrow("Failed to query tickets");

    // Verify the raw error is not leaked in the thrown message
    try {
      await tickets(undefined, { state: "BACKLOG", labelName: "bug" }, ctx);
    } catch (e: any) {
      expect(e.message).not.toContain("DB connection failed");
    }

    // Verify the error is logged for observability
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Pagination — take / first / clamp
// ---------------------------------------------------------------------------
describe("tickets — pagination query args", () => {
  it("uses take = first + 1 for hasNextPage detection", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { first: 10 }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.take).toBe(11);
  });

  it("defaults first to MAX_PAGE_SIZE (100) when not provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, {}, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.take).toBe(101);
  });

  it("clamps first to MAX_PAGE_SIZE (100) when a value larger than 100 is provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { first: 9999 }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.take).toBe(101);
  });

  it("clamps first to 1 when a value less than 1 is provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { first: 0 }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.take).toBe(2);
  });

  it("sets cursor and skip when after is provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { after: "ticket-id-abc" }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: "ticket-id-abc" });
    expect(call.skip).toBe(1);
  });

  it("does not set cursor or skip when after is not provided", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, {}, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.cursor).toBeUndefined();
    expect(call.skip).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasNextPage and edge construction
// ---------------------------------------------------------------------------
describe("tickets — hasNextPage and edge construction", () => {
  it("sets hasNextPage to false when results do not exceed first", async () => {
    const mockTickets = [
      { id: "t1", title: "Ticket 1" },
      { id: "t2", title: "Ticket 2" },
    ];
    const ctx = makeMockContext(mockTickets);
    const result = await tickets(undefined, { first: 5 }, ctx);

    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.edges).toHaveLength(2);
  });

  it("sets hasNextPage to true when results exceed first", async () => {
    // first=2, so we ask for take=3; return 3 results to signal there is a next page
    const mockTickets = [
      { id: "t1", title: "Ticket 1" },
      { id: "t2", title: "Ticket 2" },
      { id: "t3", title: "Ticket 3" },
    ];
    const ctx = makeMockContext(mockTickets);
    const result = await tickets(undefined, { first: 2 }, ctx);

    expect(result.pageInfo.hasNextPage).toBe(true);
    // The extra sentinel ticket must be sliced off — only `first` edges returned
    expect(result.edges).toHaveLength(2);
  });

  it("constructs edges with cursor equal to ticket id and node equal to the ticket", async () => {
    const mockTickets = [{ id: "t-abc", title: "Some Ticket" }];
    const ctx = makeMockContext(mockTickets);
    const result = await tickets(undefined, { first: 5 }, ctx);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].cursor).toBe("t-abc");
    expect(result.edges[0].node).toEqual({ id: "t-abc", title: "Some Ticket" });
  });

  it("sets endCursor to the last edge cursor when edges exist", async () => {
    const mockTickets = [
      { id: "t1", title: "Ticket 1" },
      { id: "t2", title: "Ticket 2" },
    ];
    const ctx = makeMockContext(mockTickets);
    const result = await tickets(undefined, { first: 5 }, ctx);

    expect(result.pageInfo.endCursor).toBe("t2");
  });

  it("sets endCursor to null when there are no results", async () => {
    const ctx = makeMockContext([]);
    const result = await tickets(undefined, {}, ctx);

    expect(result.pageInfo.endCursor).toBeNull();
    expect(result.edges).toHaveLength(0);
    expect(result.pageInfo.hasNextPage).toBe(false);
  });
});
