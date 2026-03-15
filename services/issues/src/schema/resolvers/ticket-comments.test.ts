import { describe, it, expect, vi } from "vitest";
import { ticketResolvers } from "./ticket.js";
import type { User } from "@prisma/client";

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

function makeMockContext(currentUser: User | null, prismaOverrides = {}) {
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
      ...prismaOverrides,
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

  it("rejects a different user from updating the comment", async () => {
    const ctx = makeMockContext(otherUser);
    ctx.prisma.comment.findUnique.mockResolvedValue({
      id: "c1",
      authorId: mockUser.id,
    });

    await expect(
      updateComment(undefined, { id: "c1", body: "hacked" }, ctx)
    ).rejects.toThrow("You can only edit your own comments");
  });

  it("throws FORBIDDEN code for ownership violations", async () => {
    const ctx = makeMockContext(otherUser);
    ctx.prisma.comment.findUnique.mockResolvedValue({
      id: "c1",
      authorId: mockUser.id,
    });

    try {
      await updateComment(undefined, { id: "c1", body: "hacked" }, ctx);
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.extensions?.code).toBe("FORBIDDEN");
    }
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

  it("rejects a different user from deleting the comment", async () => {
    const ctx = makeMockContext(otherUser);
    ctx.prisma.comment.findUnique.mockResolvedValue({
      id: "c1",
      authorId: mockUser.id,
      author: mockUser,
    });

    await expect(
      deleteComment(undefined, { id: "c1" }, ctx)
    ).rejects.toThrow("You can only delete your own comments");
  });

  it("throws FORBIDDEN code for ownership violations", async () => {
    const ctx = makeMockContext(otherUser);
    ctx.prisma.comment.findUnique.mockResolvedValue({
      id: "c1",
      authorId: mockUser.id,
      author: mockUser,
    });

    try {
      await deleteComment(undefined, { id: "c1" }, ctx);
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.extensions?.code).toBe("FORBIDDEN");
    }
  });
});
