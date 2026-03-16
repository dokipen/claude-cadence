import { describe, it, expect, vi } from "vitest";
import { GraphQLError } from "graphql";
import type { User } from "@prisma/client";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

const { ticketResolvers } = await import("./ticket.js");

const mockUser: User = {
  id: "user-1",
  githubId: 1001,
  login: "alice",
  displayName: "Alice",
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const otherUser: User = {
  id: "user-2",
  githubId: 1002,
  login: "bob",
  displayName: "Bob",
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeMockContext(currentUser: User | null) {
  return {
    prisma: {
      comment: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      ticket: {
        findUnique: vi.fn(),
      },
    } as any,
    loaders: {} as any,
    currentUser,
  };
}

const { updateComment, deleteComment, addComment } = ticketResolvers.Mutation;

describe("addComment", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      addComment(undefined, { ticketId: "t1", body: "hello" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("creates comment with authenticated user as author", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue({ id: "t1" });
    ctx.prisma.comment.create.mockResolvedValue({
      id: "c1",
      body: "hello",
      authorId: mockUser.id,
      author: mockUser,
    });

    const result = await addComment(
      undefined,
      { ticketId: "t1", body: "hello" },
      ctx
    );

    expect(ctx.prisma.comment.create).toHaveBeenCalledWith({
      data: { ticketId: "t1", body: "hello", authorId: mockUser.id },
      include: { author: true },
    });
    expect(result.authorId).toBe(mockUser.id);
  });

  it("throws BAD_USER_INPUT for empty body", async () => {
    const ctx = makeMockContext(mockUser);

    await expect(
      addComment(undefined, { ticketId: "t1", body: "   " }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      addComment(undefined, { ticketId: "t1", body: "   " }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("throws NOT_FOUND when ticket does not exist", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(
      addComment(undefined, { ticketId: "missing", body: "hello" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      addComment(undefined, { ticketId: "missing", body: "hello" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws INTERNAL_SERVER_ERROR on DB failure", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue({ id: "t1" });
    ctx.prisma.comment.create.mockRejectedValue(new Error("DB error"));

    await expect(
      addComment(undefined, { ticketId: "t1", body: "hello" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      addComment(undefined, { ticketId: "t1", body: "hello" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });
});

describe("updateComment", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      updateComment(undefined, { id: "c1", body: "updated" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("allows the author to update their own comment", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.comment.findUnique.mockResolvedValue({
      id: "c1",
      authorId: mockUser.id,
    });
    ctx.prisma.comment.update.mockResolvedValue({
      id: "c1",
      body: "updated",
      authorId: mockUser.id,
      author: mockUser,
    });

    const result = await updateComment(
      undefined,
      { id: "c1", body: "updated" },
      ctx
    );
    expect(result.body).toBe("updated");
  });

  it("throws BAD_USER_INPUT for empty body", async () => {
    const ctx = makeMockContext(mockUser);

    await expect(
      updateComment(undefined, { id: "c1", body: "" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      updateComment(undefined, { id: "c1", body: "" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("throws NOT_FOUND when comment does not exist", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.comment.findUnique.mockResolvedValue(null);

    await expect(
      updateComment(undefined, { id: "missing", body: "text" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      updateComment(undefined, { id: "missing", body: "text" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws FORBIDDEN when a different user attempts to edit", async () => {
    const ctx = makeMockContext(otherUser);
    ctx.prisma.comment.findUnique.mockResolvedValue({
      id: "c1",
      authorId: mockUser.id,
    });

    await expect(
      updateComment(undefined, { id: "c1", body: "hacked" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      updateComment(undefined, { id: "c1", body: "hacked" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});

describe("deleteComment", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      deleteComment(undefined, { id: "c1" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("allows the author to delete their own comment", async () => {
    const ctx = makeMockContext(mockUser);
    const existing = {
      id: "c1",
      authorId: mockUser.id,
      author: mockUser,
    };
    ctx.prisma.comment.findUnique.mockResolvedValue(existing);
    ctx.prisma.comment.delete.mockResolvedValue(existing);

    const result = await deleteComment(undefined, { id: "c1" }, ctx);
    expect(result.id).toBe("c1");
    expect(ctx.prisma.comment.delete).toHaveBeenCalledWith({
      where: { id: "c1" },
    });
  });

  it("throws NOT_FOUND when comment does not exist", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.comment.findUnique.mockResolvedValue(null);

    await expect(
      deleteComment(undefined, { id: "missing" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      deleteComment(undefined, { id: "missing" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws FORBIDDEN when a different user attempts to delete", async () => {
    const ctx = makeMockContext(otherUser);
    ctx.prisma.comment.findUnique.mockResolvedValue({
      id: "c1",
      authorId: mockUser.id,
      author: mockUser,
    });

    await expect(
      deleteComment(undefined, { id: "c1" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      deleteComment(undefined, { id: "c1" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("throws INTERNAL_SERVER_ERROR on DB failure during delete", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.comment.findUnique.mockResolvedValue({
      id: "c1",
      authorId: mockUser.id,
      author: mockUser,
    });
    ctx.prisma.comment.delete.mockRejectedValue(new Error("DB error"));

    await expect(
      deleteComment(undefined, { id: "c1" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      deleteComment(undefined, { id: "c1" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });
});
