import { describe, it, expect, vi } from "vitest";
import type { User } from "@prisma/client";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

const { ticketResolvers } = await import("./ticket.js");

const { createTicket } = ticketResolvers.Mutation;
const { ticketByNumber } = ticketResolvers.Query;

const mockUser: User = {
  id: "user-1",
  githubId: 1001,
  login: "alice",
  displayName: "Alice",
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeMockContext() {
  const txMock = {
    project: {
      findUnique: vi.fn(),
    },
    ticket: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  };

  return {
    context: {
      prisma: {
        $transaction: vi.fn(async (fn: (tx: typeof txMock) => Promise<unknown>) => {
          return fn(txMock);
        }),
        ticket: {
          findUnique: vi.fn(),
        },
      } as any,
      loaders: {} as any,
      currentUser: mockUser,
    },
    txMock,
  };
}

describe("createTicket — number assignment", () => {
  it("assigns number 1 to the first ticket in a project", async () => {
    const { context, txMock } = makeMockContext();

    txMock.project.findUnique.mockResolvedValue({ id: "proj-1", name: "Test" });
    txMock.ticket.findFirst.mockResolvedValue(null); // no existing tickets
    const createdTicket = {
      id: "ticket-1",
      number: 1,
      title: "First ticket",
      projectId: "proj-1",
    };
    txMock.ticket.create.mockResolvedValue(createdTicket);

    const result = await createTicket(
      {},
      { input: { title: "First ticket", projectId: "proj-1" } },
      context
    );

    expect(result).toEqual(createdTicket);
    expect(txMock.ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ number: 1 }),
    });
  });

  it("assigns the next sequential number based on existing tickets", async () => {
    const { context, txMock } = makeMockContext();

    txMock.project.findUnique.mockResolvedValue({ id: "proj-1", name: "Test" });
    txMock.ticket.findFirst.mockResolvedValue({ number: 5 }); // highest existing
    const createdTicket = {
      id: "ticket-6",
      number: 6,
      title: "Next ticket",
      projectId: "proj-1",
    };
    txMock.ticket.create.mockResolvedValue(createdTicket);

    const result = await createTicket(
      {},
      { input: { title: "Next ticket", projectId: "proj-1" } },
      context
    );

    expect(result).toEqual(createdTicket);
    expect(txMock.ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ number: 6 }),
    });
  });

  it("queries the correct project for the max number", async () => {
    const { context, txMock } = makeMockContext();

    txMock.project.findUnique.mockResolvedValue({ id: "proj-2", name: "Other" });
    txMock.ticket.findFirst.mockResolvedValue(null);
    txMock.ticket.create.mockResolvedValue({ id: "t-1", number: 1 });

    await createTicket(
      {},
      { input: { title: "Scoped ticket", projectId: "proj-2" } },
      context
    );

    expect(txMock.ticket.findFirst).toHaveBeenCalledWith({
      where: { projectId: "proj-2" },
      orderBy: { number: "desc" },
      select: { number: true },
    });
  });

  it("throws when project is not found", async () => {
    const { context, txMock } = makeMockContext();
    txMock.project.findUnique.mockResolvedValue(null);

    await expect(
      createTicket(
        {},
        { input: { title: "Orphan ticket", projectId: "nonexistent" } },
        context
      )
    ).rejects.toThrow("Project not found: nonexistent");
  });

  it("retries on P2002 unique constraint violation", async () => {
    const { context, txMock } = makeMockContext();

    txMock.project.findUnique.mockResolvedValue({ id: "proj-1", name: "Test" });
    txMock.ticket.findFirst.mockResolvedValue({ number: 5 });

    // First attempt: unique constraint violation
    const p2002Error = Object.assign(new Error("Unique constraint"), { code: "P2002" });
    txMock.ticket.create
      .mockRejectedValueOnce(p2002Error)
      .mockResolvedValueOnce({ id: "t-1", number: 6, title: "Retry success" });

    const result = await createTicket(
      {},
      { input: { title: "Retry success", projectId: "proj-1" } },
      context
    );

    expect(result).toEqual({ id: "t-1", number: 6, title: "Retry success" });
    expect(context.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries on repeated P2002", async () => {
    const { context, txMock } = makeMockContext();

    txMock.project.findUnique.mockResolvedValue({ id: "proj-1", name: "Test" });
    txMock.ticket.findFirst.mockResolvedValue({ number: 5 });

    const p2002Error = Object.assign(new Error("Unique constraint"), { code: "P2002" });
    txMock.ticket.create.mockRejectedValue(p2002Error);

    await expect(
      createTicket(
        {},
        { input: { title: "Always fails", projectId: "proj-1" } },
        context
      )
    ).rejects.toThrow("Unique constraint");

    expect(context.prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

describe("ticketByNumber", () => {
  it("looks up a ticket by projectId and number", async () => {
    const { context } = makeMockContext();
    const ticket = { id: "t-1", number: 3, title: "Found it", projectId: "proj-1" };
    context.prisma.ticket.findUnique.mockResolvedValue(ticket);

    const result = await ticketByNumber(
      {},
      { projectId: "proj-1", number: 3 },
      context
    );

    expect(result).toEqual(ticket);
    expect(context.prisma.ticket.findUnique).toHaveBeenCalledWith({
      where: { projectId_number: { projectId: "proj-1", number: 3 } },
    });
  });

  it("returns null when no ticket matches", async () => {
    const { context } = makeMockContext();
    context.prisma.ticket.findUnique.mockResolvedValue(null);

    const result = await ticketByNumber(
      {},
      { projectId: "proj-1", number: 999 },
      context
    );

    expect(result).toBeNull();
  });
});
