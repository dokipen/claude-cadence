import { describe, it, expect, vi } from "vitest";
import { GraphQLError } from "graphql";
import type { User } from "@prisma/client";
import { Prisma } from "@prisma/client";

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

function makeMockContext(currentUser: User | null) {
  const txMock = {
    project: { findUnique: vi.fn() },
    ticket: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    blockRelation: { count: vi.fn() },
  };

  return {
    ctx: {
      prisma: {
        ticket: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
        label: { findUnique: vi.fn(), create: vi.fn() },
        ticketLabel: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
        blockRelation: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
        project: { findUnique: vi.fn() },
        user: { findUnique: vi.fn() },
        $transaction: vi.fn(async (fn: any) => fn(txMock)),
      } as any,
      loaders: {} as any,
      currentUser,
    },
    txMock,
  };
}

const {
  createTicket,
  updateTicket,
  createLabel,
  addLabel,
  removeLabel,
  assignTicket,
  unassignTicket,
  transitionTicket,
  addBlockRelation,
  removeBlockRelation,
} = ticketResolvers.Mutation;

describe("createTicket", () => {
  it("rejects unauthenticated users", async () => {
    const { ctx } = makeMockContext(null);
    await expect(
      createTicket(undefined, { input: { title: "t", projectId: "p1" } }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("creates a ticket with valid input", async () => {
    const { ctx, txMock } = makeMockContext(mockUser);
    txMock.project.findUnique.mockResolvedValue({ id: "proj-1", name: "Test" });
    txMock.ticket.findFirst.mockResolvedValue(null);
    const createdTicket = {
      id: "ticket-1",
      number: 1,
      title: "New ticket",
      projectId: "proj-1",
      state: "BACKLOG",
    };
    txMock.ticket.create.mockResolvedValue(createdTicket);

    const result = await createTicket(
      undefined,
      { input: { title: "New ticket", projectId: "proj-1" } },
      ctx
    );

    expect(result).toEqual(createdTicket);
    expect(txMock.ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ number: 1, title: "New ticket" }),
    });
  });

  it("throws NOT_FOUND when project does not exist", async () => {
    const { ctx, txMock } = makeMockContext(mockUser);
    txMock.project.findUnique.mockResolvedValue(null);

    await expect(
      createTicket(undefined, { input: { title: "t", projectId: "missing" } }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      createTicket(undefined, { input: { title: "t", projectId: "missing" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws BAD_USER_INPUT for invalid priority", async () => {
    const { ctx } = makeMockContext(mockUser);

    await expect(
      createTicket(undefined, { input: { title: "t", projectId: "p1", priority: "INVALID" } }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      createTicket(undefined, { input: { title: "t", projectId: "p1", priority: "INVALID" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("throws INTERNAL_SERVER_ERROR on unexpected DB failure", async () => {
    const { ctx, txMock } = makeMockContext(mockUser);
    txMock.project.findUnique.mockResolvedValue({ id: "proj-1", name: "Test" });
    txMock.ticket.findFirst.mockResolvedValue(null);
    txMock.ticket.create.mockRejectedValue(new Error("DB connection lost"));

    await expect(
      createTicket(undefined, { input: { title: "t", projectId: "proj-1" } }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      createTicket(undefined, { input: { title: "t", projectId: "proj-1" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });

  it("retries on P2034 write conflict and succeeds on second attempt", async () => {
    const { ctx, txMock } = makeMockContext(mockUser);
    txMock.project.findUnique.mockResolvedValue({ id: "proj-1", name: "Test" });
    txMock.ticket.findFirst.mockResolvedValue(null);
    const createdTicket = { id: "ticket-1", number: 1, title: "New ticket", projectId: "proj-1", state: "BACKLOG" };
    const writeConflict = new Prisma.PrismaClientKnownRequestError("write conflict", {
      code: "P2034",
      clientVersion: "0.0.0",
    });
    txMock.ticket.create
      .mockRejectedValueOnce(writeConflict)
      .mockResolvedValueOnce(createdTicket);

    const result = await createTicket(
      undefined,
      { input: { title: "New ticket", projectId: "proj-1" } },
      ctx
    );

    expect(result).toEqual(createdTicket);
    expect(txMock.ticket.create).toHaveBeenCalledTimes(2);
  });

  it("throws INTERNAL_SERVER_ERROR after exhausting P2034 retries", async () => {
    const { ctx, txMock } = makeMockContext(mockUser);
    txMock.project.findUnique.mockResolvedValue({ id: "proj-1", name: "Test" });
    txMock.ticket.findFirst.mockResolvedValue(null);
    const writeConflict = new Prisma.PrismaClientKnownRequestError("write conflict", {
      code: "P2034",
      clientVersion: "0.0.0",
    });
    txMock.ticket.create.mockRejectedValue(writeConflict);

    await expect(
      createTicket(undefined, { input: { title: "t", projectId: "proj-1" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });

    // All 3 attempts exhausted
    expect(txMock.ticket.create).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-Prisma errors that happen to have a code property", async () => {
    const { ctx, txMock } = makeMockContext(mockUser);
    txMock.project.findUnique.mockResolvedValue({ id: "proj-1", name: "Test" });
    txMock.ticket.findFirst.mockResolvedValue(null);
    // A Node.js SystemError has a .code property but is not a PrismaClientKnownRequestError
    const sysError = Object.assign(new Error("ENOENT"), { code: "P2034" });
    txMock.ticket.create.mockRejectedValue(sysError);

    await expect(
      createTicket(undefined, { input: { title: "t", projectId: "proj-1" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });

    // Only 1 attempt — no retry for non-Prisma errors
    expect(txMock.ticket.create).toHaveBeenCalledTimes(1);
  });
});

describe("updateTicket", () => {
  it("rejects unauthenticated users", async () => {
    const { ctx } = makeMockContext(null);
    await expect(
      updateTicket(undefined, { id: "t1", input: { title: "updated" } }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("updates ticket fields", async () => {
    const { ctx } = makeMockContext(mockUser);
    const existing = { id: "t1", title: "Old title", state: "BACKLOG" };
    const updated = { id: "t1", title: "New title", state: "BACKLOG" };
    ctx.prisma.ticket.findUnique.mockResolvedValue(existing);
    ctx.prisma.ticket.update.mockResolvedValue(updated);

    const result = await updateTicket(
      undefined,
      { id: "t1", input: { title: "New title" } },
      ctx
    );

    expect(result).toEqual(updated);
    expect(ctx.prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: expect.objectContaining({ title: "New title" }),
    });
  });

  it("throws NOT_FOUND when ticket does not exist", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(
      updateTicket(undefined, { id: "missing", input: { title: "x" } }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      updateTicket(undefined, { id: "missing", input: { title: "x" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws BAD_USER_INPUT for invalid priority", async () => {
    const { ctx } = makeMockContext(mockUser);

    await expect(
      updateTicket(undefined, { id: "t1", input: { priority: "WRONG" } }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      updateTicket(undefined, { id: "t1", input: { priority: "WRONG" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("throws INTERNAL_SERVER_ERROR on unexpected DB failure", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue({ id: "t1", title: "Existing" });
    ctx.prisma.ticket.update.mockRejectedValue(new Error("DB failure"));

    await expect(
      updateTicket(undefined, { id: "t1", input: { title: "New" } }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      updateTicket(undefined, { id: "t1", input: { title: "New" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });
});

describe("createLabel", () => {
  it("rejects unauthenticated users", async () => {
    const { ctx } = makeMockContext(null);
    await expect(
      createLabel(undefined, { name: "bug", color: "#ff0000" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("creates a label with valid hex color", async () => {
    const { ctx } = makeMockContext(mockUser);
    const label = { id: "l1", name: "bug", color: "#ff0000" };
    ctx.prisma.label.create.mockResolvedValue(label);

    const result = await createLabel(
      undefined,
      { name: "bug", color: "#ff0000" },
      ctx
    );

    expect(result).toEqual(label);
    expect(ctx.prisma.label.create).toHaveBeenCalledWith({
      data: { name: "bug", color: "#ff0000" },
    });
  });

  it("throws BAD_USER_INPUT for invalid color format", async () => {
    const { ctx } = makeMockContext(mockUser);

    await expect(
      createLabel(undefined, { name: "bad", color: "not-a-color" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      createLabel(undefined, { name: "bad", color: "not-a-color" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("throws INTERNAL_SERVER_ERROR on DB failure", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.label.create.mockRejectedValue(new Error("DB error"));

    await expect(
      createLabel(undefined, { name: "bug", color: "#ff0000" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      createLabel(undefined, { name: "bug", color: "#ff0000" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });

  it("throws CONFLICT when label name already exists (P2002)", async () => {
    const { ctx } = makeMockContext(mockUser);
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed", { code: "P2002", clientVersion: "0.0.0" }
    );
    ctx.prisma.label.create.mockRejectedValue(prismaError);

    await expect(
      createLabel(undefined, { name: "bug", color: "#ff0000" }, ctx)
    ).rejects.toThrow("A label with that name already exists");

    await expect(
      createLabel(undefined, { name: "bug", color: "#ff0000" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
  });
});

describe("addLabel", () => {
  it("rejects unauthenticated users", async () => {
    const { ctx } = makeMockContext(null);
    await expect(
      addLabel(undefined, { ticketId: "t1", labelId: "l1" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("adds label to ticket", async () => {
    const { ctx } = makeMockContext(mockUser);
    const ticket = { id: "t1", title: "My ticket" };
    ctx.prisma.ticket.findUnique.mockResolvedValue(ticket);
    ctx.prisma.label.findUnique.mockResolvedValue({ id: "l1", name: "bug" });
    ctx.prisma.ticketLabel.create.mockResolvedValue({});

    const result = await addLabel(
      undefined,
      { ticketId: "t1", labelId: "l1" },
      ctx
    );

    expect(result).toEqual(ticket);
    expect(ctx.prisma.ticketLabel.create).toHaveBeenCalledWith({
      data: { ticketId: "t1", labelId: "l1" },
    });
  });

  it("throws NOT_FOUND when ticket does not exist", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(
      addLabel(undefined, { ticketId: "missing", labelId: "l1" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      addLabel(undefined, { ticketId: "missing", labelId: "l1" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws NOT_FOUND when label does not exist", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue({ id: "t1" });
    ctx.prisma.label.findUnique.mockResolvedValue(null);

    await expect(
      addLabel(undefined, { ticketId: "t1", labelId: "missing" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      addLabel(undefined, { ticketId: "t1", labelId: "missing" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws CONFLICT when label is already on ticket (P2002)", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue({ id: "t1" });
    ctx.prisma.label.findUnique.mockResolvedValue({ id: "l1", name: "bug" });
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed", { code: "P2002", clientVersion: "0.0.0" }
    );
    ctx.prisma.ticketLabel.create.mockRejectedValue(prismaError);

    await expect(
      addLabel(undefined, { ticketId: "t1", labelId: "l1" }, ctx)
    ).rejects.toThrow("Label is already on this ticket");

    await expect(
      addLabel(undefined, { ticketId: "t1", labelId: "l1" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
  });
});

describe("removeLabel", () => {
  it("rejects unauthenticated users", async () => {
    const { ctx } = makeMockContext(null);
    await expect(
      removeLabel(undefined, { ticketId: "t1", labelId: "l1" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("removes label from ticket", async () => {
    const { ctx } = makeMockContext(mockUser);
    const ticket = { id: "t1", title: "My ticket" };
    ctx.prisma.ticket.findUnique.mockResolvedValue(ticket);
    ctx.prisma.ticketLabel.findUnique.mockResolvedValue({ ticketId: "t1", labelId: "l1" });
    ctx.prisma.ticketLabel.delete.mockResolvedValue({});

    const result = await removeLabel(
      undefined,
      { ticketId: "t1", labelId: "l1" },
      ctx
    );

    expect(result).toEqual(ticket);
  });

  it("throws NOT_FOUND when ticket does not exist", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(
      removeLabel(undefined, { ticketId: "missing", labelId: "l1" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      removeLabel(undefined, { ticketId: "missing", labelId: "l1" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws NOT_FOUND when label is not on ticket", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue({ id: "t1", title: "My ticket" });
    ctx.prisma.ticketLabel.findUnique.mockResolvedValue(null);

    await expect(
      removeLabel(undefined, { ticketId: "t1", labelId: "l1" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      removeLabel(undefined, { ticketId: "t1", labelId: "l1" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});

describe("assignTicket", () => {
  it("rejects unauthenticated users", async () => {
    const { ctx } = makeMockContext(null);
    await expect(
      assignTicket(undefined, { ticketId: "t1", userId: "u1" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("assigns user to ticket", async () => {
    const { ctx } = makeMockContext(mockUser);
    const ticket = { id: "t1", title: "My ticket", assigneeId: null };
    const updated = { id: "t1", title: "My ticket", assigneeId: "u1" };
    ctx.prisma.ticket.findUnique.mockResolvedValue(ticket);
    ctx.prisma.user.findUnique.mockResolvedValue(mockUser);
    ctx.prisma.ticket.update.mockResolvedValue(updated);

    const result = await assignTicket(
      undefined,
      { ticketId: "t1", userId: "u1" },
      ctx
    );

    expect(result).toEqual(updated);
    expect(ctx.prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { assigneeId: "u1" },
    });
  });

  it("throws NOT_FOUND when ticket does not exist", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(
      assignTicket(undefined, { ticketId: "missing", userId: "u1" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      assignTicket(undefined, { ticketId: "missing", userId: "u1" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws NOT_FOUND when user does not exist", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue({ id: "t1" });
    ctx.prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      assignTicket(undefined, { ticketId: "t1", userId: "missing-user" }, ctx)
    ).rejects.toThrow("User not found");

    await expect(
      assignTicket(undefined, { ticketId: "t1", userId: "missing-user" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws INTERNAL_SERVER_ERROR on DB failure", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue({ id: "t1" });
    ctx.prisma.user.findUnique.mockResolvedValue(mockUser);
    ctx.prisma.ticket.update.mockRejectedValue(new Error("DB error"));

    await expect(
      assignTicket(undefined, { ticketId: "t1", userId: "u1" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      assignTicket(undefined, { ticketId: "t1", userId: "u1" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });
});

describe("unassignTicket", () => {
  it("rejects unauthenticated users", async () => {
    const { ctx } = makeMockContext(null);
    await expect(
      unassignTicket(undefined, { ticketId: "t1" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("removes assignee from ticket", async () => {
    const { ctx } = makeMockContext(mockUser);
    const ticket = { id: "t1", title: "My ticket", assigneeId: "u1" };
    const updated = { id: "t1", title: "My ticket", assigneeId: null };
    ctx.prisma.ticket.findUnique.mockResolvedValue(ticket);
    ctx.prisma.ticket.update.mockResolvedValue(updated);

    const result = await unassignTicket(
      undefined,
      { ticketId: "t1" },
      ctx
    );

    expect(result).toEqual(updated);
    expect(ctx.prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { assigneeId: null },
    });
  });

  it("throws NOT_FOUND when ticket does not exist", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(
      unassignTicket(undefined, { ticketId: "missing" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      unassignTicket(undefined, { ticketId: "missing" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});

describe("transitionTicket", () => {
  it("rejects unauthenticated users", async () => {
    const { ctx } = makeMockContext(null);
    await expect(
      transitionTicket(undefined, { id: "t1", to: "IN_PROGRESS" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("transitions ticket to valid state", async () => {
    const { ctx, txMock } = makeMockContext(mockUser);
    const ticket = { id: "t1", title: "My ticket", state: "REFINED" };
    const updated = { id: "t1", title: "My ticket", state: "IN_PROGRESS" };
    txMock.ticket.findUnique.mockResolvedValue(ticket);
    txMock.blockRelation.count.mockResolvedValue(0);
    txMock.ticket.update.mockResolvedValue(updated);

    const result = await transitionTicket(
      undefined,
      { id: "t1", to: "IN_PROGRESS" },
      ctx
    );

    expect(result).toEqual(updated);
    expect(txMock.blockRelation.count).toHaveBeenCalledWith({
      where: {
        blockedId: "t1",
        blocker: { state: { not: "CLOSED" } },
      },
    });
    expect(txMock.ticket.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { state: "IN_PROGRESS" },
    });
  });
});

describe("addBlockRelation", () => {
  it("rejects unauthenticated users", async () => {
    const { ctx } = makeMockContext(null);
    await expect(
      addBlockRelation(undefined, { blockerId: "t1", blockedId: "t2" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("creates block relation between tickets", async () => {
    const { ctx } = makeMockContext(mockUser);
    const blocker = { id: "t1", title: "Blocker" };
    const blocked = { id: "t2", title: "Blocked" };
    ctx.prisma.ticket.findUnique
      .mockResolvedValueOnce(blocker)
      .mockResolvedValueOnce(blocked);
    ctx.prisma.blockRelation.upsert.mockResolvedValue({});

    const result = await addBlockRelation(
      undefined,
      { blockerId: "t1", blockedId: "t2" },
      ctx
    );

    expect(result).toEqual(blocked);
    expect(ctx.prisma.blockRelation.upsert).toHaveBeenCalledWith({
      where: { blockerId_blockedId: { blockerId: "t1", blockedId: "t2" } },
      create: { blockerId: "t1", blockedId: "t2" },
      update: {},
    });
  });

  it("throws BAD_USER_INPUT for self-blocking", async () => {
    const { ctx } = makeMockContext(mockUser);

    await expect(
      addBlockRelation(undefined, { blockerId: "t1", blockedId: "t1" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      addBlockRelation(undefined, { blockerId: "t1", blockedId: "t1" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("throws NOT_FOUND when blocker ticket does not exist", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValueOnce(null);

    await expect(
      addBlockRelation(undefined, { blockerId: "missing", blockedId: "t2" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      addBlockRelation(undefined, { blockerId: "missing", blockedId: "t2" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws NOT_FOUND when blocked ticket does not exist", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique
      .mockResolvedValueOnce({ id: "t1" })
      .mockResolvedValueOnce(null);

    await expect(
      addBlockRelation(undefined, { blockerId: "t1", blockedId: "missing" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      addBlockRelation(undefined, { blockerId: "t1", blockedId: "missing" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});

describe("removeBlockRelation", () => {
  it("rejects unauthenticated users", async () => {
    const { ctx } = makeMockContext(null);
    await expect(
      removeBlockRelation(undefined, { blockerId: "t1", blockedId: "t2" }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("removes existing block relation", async () => {
    const { ctx } = makeMockContext(mockUser);
    const existing = { blockerId: "t1", blockedId: "t2" };
    const blockedTicket = { id: "t2", title: "Blocked" };
    ctx.prisma.blockRelation.findUnique.mockResolvedValue(existing);
    ctx.prisma.blockRelation.delete.mockResolvedValue(existing);
    ctx.prisma.ticket.findUniqueOrThrow.mockResolvedValue(blockedTicket);

    const result = await removeBlockRelation(
      undefined,
      { blockerId: "t1", blockedId: "t2" },
      ctx
    );

    expect(result).toEqual(blockedTicket);
  });

  it("throws NOT_FOUND when relation does not exist", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.blockRelation.findUnique.mockResolvedValue(null);

    await expect(
      removeBlockRelation(undefined, { blockerId: "t1", blockedId: "t2" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      removeBlockRelation(undefined, { blockerId: "t1", blockedId: "t2" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws INTERNAL_SERVER_ERROR on DB failure during delete", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.blockRelation.findUnique.mockResolvedValue({ blockerId: "t1", blockedId: "t2" });
    ctx.prisma.blockRelation.delete.mockRejectedValue(new Error("DB error"));

    await expect(
      removeBlockRelation(undefined, { blockerId: "t1", blockedId: "t2" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      removeBlockRelation(undefined, { blockerId: "t1", blockedId: "t2" }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });
});
