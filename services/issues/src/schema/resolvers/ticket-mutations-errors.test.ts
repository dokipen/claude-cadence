import { describe, it, expect, vi, beforeAll } from "vitest";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

/** Create an error that looks like a Prisma client error (has a P-code). */
function prismaError(message: string, code = "P2010"): Error {
  const err = new Error(message);
  (err as any).code = code;
  return err;
}

let resolvers: any;

const mockUser = {
  id: "user-1",
  login: "test",
  displayName: "Test",
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeAll(async () => {
  const mod = await import("./ticket.js");
  resolvers = mod.ticketResolvers;
});

describe("labels query — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        label: {
          findMany: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: null,
    };

    await expect(
      resolvers.Query.labels(undefined, undefined, ctx)
    ).rejects.toMatchObject({
      message: "Failed to fetch labels",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("labels query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("createTicket mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        $transaction: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.createTicket(undefined, {
        input: { title: "Test", projectId: "proj-1" },
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to create ticket",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("createTicket mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("updateTicket mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findUnique: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.updateTicket(undefined, {
        id: "t-1",
        input: { title: "Updated" },
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to update ticket",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("updateTicket mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("createLabel mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        label: {
          create: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.createLabel(undefined, {
        name: "bug",
        color: "#ff0000",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to create label",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("createLabel mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("addLabel mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findUnique: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.addLabel(undefined, {
        ticketId: "t-1",
        labelId: "l-1",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to add label",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("addLabel mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("removeLabel mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findUnique: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.removeLabel(undefined, {
        ticketId: "t-1",
        labelId: "l-1",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to remove label",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("removeLabel mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("assignTicket mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findUnique: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.assignTicket(undefined, {
        ticketId: "t-1",
        userId: "u-1",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to assign ticket",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("assignTicket mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("unassignTicket mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findUnique: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.unassignTicket(undefined, {
        ticketId: "t-1",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to unassign ticket",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("unassignTicket mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("transitionTicket mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        $transaction: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.transitionTicket(undefined, {
        id: "t-1",
        to: "IN_PROGRESS",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to transition ticket",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("transitionTicket mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("addBlockRelation mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findUnique: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.addBlockRelation(undefined, {
        blockerId: "t-1",
        blockedId: "t-2",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to add block relation",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("addBlockRelation mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("removeBlockRelation mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        blockRelation: {
          findUnique: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.removeBlockRelation(undefined, {
        blockerId: "t-1",
        blockedId: "t-2",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to remove block relation",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("removeBlockRelation mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("addComment mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findUnique: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.addComment(undefined, {
        ticketId: "t-1",
        body: "Hello",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to add comment",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("addComment mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("updateComment mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        comment: {
          findUnique: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.updateComment(undefined, {
        id: "c-1",
        body: "Updated",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to update comment",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("updateComment mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("deleteComment mutation — error handling", () => {
  it("wraps Prisma errors in a GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        comment: {
          findUnique: vi.fn().mockRejectedValue(prismaError("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    };

    await expect(
      resolvers.Mutation.deleteComment(undefined, {
        id: "c-1",
      }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to delete comment",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("deleteComment mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});
