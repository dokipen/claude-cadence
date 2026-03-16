import { describe, it, expect, vi, beforeAll } from "vitest";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

let ticketResolvers: any;

beforeAll(async () => {
  const mod = await import("./ticket.js");
  ticketResolvers = mod.ticketResolvers;
});

function makeLoaderContext(loaderOverrides: Record<string, any> = {}) {
  return {
    prisma: {} as any,
    loaders: {
      projectByProjectId: { load: vi.fn() },
      labelsByTicketId: { load: vi.fn() },
      commentsByTicketId: { load: vi.fn() },
      assigneeByUserId: { load: vi.fn() },
      blocksByTicketId: { load: vi.fn() },
      blockedByTicketId: { load: vi.fn() },
      ...loaderOverrides,
    } as any,
    currentUser: null,
  };
}

describe("Ticket.project — error handling", () => {
  it("wraps loader errors in GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeLoaderContext({
      projectByProjectId: {
        load: vi.fn().mockRejectedValue(new Error("DB timeout")),
      },
    });

    await expect(
      ticketResolvers.Ticket.project(
        { projectId: "proj-1" },
        undefined,
        ctx
      )
    ).rejects.toMatchObject({
      message: "Failed to load project",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ticket project query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });

  it("throws GraphQLError when project is null", async () => {
    const ctx = makeLoaderContext({
      projectByProjectId: {
        load: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(
      ticketResolvers.Ticket.project(
        { projectId: "proj-1" },
        undefined,
        ctx
      )
    ).rejects.toMatchObject({
      message: "Project not found for ticket",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  });
});

describe("Ticket.labels — error handling", () => {
  it("wraps loader errors in GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeLoaderContext({
      labelsByTicketId: {
        load: vi.fn().mockRejectedValue(new Error("DB timeout")),
      },
    });

    await expect(
      ticketResolvers.Ticket.labels({ id: "t-1" }, undefined, ctx)
    ).rejects.toMatchObject({
      message: "Failed to load labels",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ticket labels query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("Ticket.comments — error handling", () => {
  it("wraps loader errors in GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeLoaderContext({
      commentsByTicketId: {
        load: vi.fn().mockRejectedValue(new Error("DB timeout")),
      },
    });

    await expect(
      ticketResolvers.Ticket.comments({ id: "t-1" }, undefined, ctx)
    ).rejects.toMatchObject({
      message: "Failed to load comments",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ticket comments query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("Ticket.assignee — error handling", () => {
  it("returns null when assigneeId is null", async () => {
    const ctx = makeLoaderContext();

    const result = await ticketResolvers.Ticket.assignee(
      { assigneeId: null },
      undefined,
      ctx
    );

    expect(result).toBeNull();
    expect(ctx.loaders.assigneeByUserId.load).not.toHaveBeenCalled();
  });

  it("wraps loader errors in GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeLoaderContext({
      assigneeByUserId: {
        load: vi.fn().mockRejectedValue(new Error("DB timeout")),
      },
    });

    await expect(
      ticketResolvers.Ticket.assignee(
        { assigneeId: "user-1" },
        undefined,
        ctx
      )
    ).rejects.toMatchObject({
      message: "Failed to load assignee",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ticket assignee query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("Ticket.blocks — error handling", () => {
  it("wraps loader errors in GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeLoaderContext({
      blocksByTicketId: {
        load: vi.fn().mockRejectedValue(new Error("DB timeout")),
      },
    });

    await expect(
      ticketResolvers.Ticket.blocks({ id: "t-1" }, undefined, ctx)
    ).rejects.toMatchObject({
      message: "Failed to load blocked tickets",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ticket blocks query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("Ticket.blockedBy — error handling", () => {
  it("wraps loader errors in GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeLoaderContext({
      blockedByTicketId: {
        load: vi.fn().mockRejectedValue(new Error("DB timeout")),
      },
    });

    await expect(
      ticketResolvers.Ticket.blockedBy({ id: "t-1" }, undefined, ctx)
    ).rejects.toMatchObject({
      message: "Failed to load blocking tickets",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ticket blockedBy query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("Comment.author — error handling", () => {
  it("wraps loader errors in GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeLoaderContext({
      assigneeByUserId: {
        load: vi.fn().mockRejectedValue(new Error("DB timeout")),
      },
    });

    await expect(
      ticketResolvers.Comment.author(
        { authorId: "user-1" },
        undefined,
        ctx
      )
    ).rejects.toMatchObject({
      message: "Failed to load comment author",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("comment author query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});
