import { describe, it, expect, vi } from "vitest";
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

  it("rejects invalid color format", async () => {
    const { ctx } = makeMockContext(mockUser);

    await expect(
      createLabel(undefined, { name: "bad", color: "not-a-color" }, ctx)
    ).rejects.toThrow("Invalid color");
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

  it("rejects when label is not on ticket", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.ticket.findUnique.mockResolvedValue({ id: "t1", title: "My ticket" });
    ctx.prisma.ticketLabel.findUnique.mockResolvedValue(null);

    await expect(
      removeLabel(undefined, { ticketId: "t1", labelId: "l1" }, ctx)
    ).rejects.toThrow(/Label .* is not on ticket/);
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

  it("rejects self-blocking", async () => {
    const { ctx } = makeMockContext(mockUser);

    await expect(
      addBlockRelation(undefined, { blockerId: "t1", blockedId: "t1" }, ctx)
    ).rejects.toThrow("cannot block itself");
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

  it("rejects when relation not found", async () => {
    const { ctx } = makeMockContext(mockUser);
    ctx.prisma.blockRelation.findUnique.mockResolvedValue(null);

    await expect(
      removeBlockRelation(undefined, { blockerId: "t1", blockedId: "t2" }, ctx)
    ).rejects.toThrow("Block relation not found");
  });
});
