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

function makeMockContext(currentUser: User | null) {
  const txMock = {
    ticket: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    blockRelation: {
      count: vi.fn().mockResolvedValue(0),
    },
  };
  return {
    context: {
      prisma: {
        $transaction: vi.fn(
          async (fn: (tx: typeof txMock) => Promise<unknown>) => {
            return fn(txMock);
          }
        ),
      } as any,
      loaders: {} as any,
      currentUser,
    },
    txMock,
  };
}

const { transitionTicket } = ticketResolvers.Mutation;

describe("transitionTicket", () => {
  it("rejects unauthenticated users", async () => {
    const { context } = makeMockContext(null);
    await expect(
      transitionTicket(undefined, { id: "t1", to: "IN_PROGRESS" }, context)
    ).rejects.toThrow("Authentication required");
  });

  it("transitions ticket for authenticated users", async () => {
    const { context, txMock } = makeMockContext(mockUser);
    txMock.ticket.findUnique.mockResolvedValue({
      id: "t1",
      state: "REFINED",
    });
    txMock.ticket.update.mockResolvedValue({
      id: "t1",
      state: "IN_PROGRESS",
    });

    const result = await transitionTicket(
      undefined,
      { id: "t1", to: "IN_PROGRESS" },
      context
    );

    expect(result).toEqual({ id: "t1", state: "IN_PROGRESS" });
  });

  it("throws NOT_FOUND when ticket does not exist", async () => {
    const { context, txMock } = makeMockContext(mockUser);
    txMock.ticket.findUnique.mockResolvedValue(null);

    await expect(
      transitionTicket(undefined, { id: "missing", to: "IN_PROGRESS" }, context)
    ).rejects.toThrow(GraphQLError);

    await expect(
      transitionTicket(undefined, { id: "missing", to: "IN_PROGRESS" }, context)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws BAD_USER_INPUT for an invalid state transition", async () => {
    const { context, txMock } = makeMockContext(mockUser);
    // CLOSED -> REFINED is not a valid FSM transition
    txMock.ticket.findUnique.mockResolvedValue({ id: "t1", state: "CLOSED" });

    await expect(
      transitionTicket(undefined, { id: "t1", to: "REFINED" }, context)
    ).rejects.toThrow(GraphQLError);

    await expect(
      transitionTicket(undefined, { id: "t1", to: "REFINED" }, context)
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("throws BAD_USER_INPUT when ticket is blocked from moving to IN_PROGRESS", async () => {
    const { context, txMock } = makeMockContext(mockUser);
    txMock.ticket.findUnique.mockResolvedValue({ id: "t1", state: "REFINED" });
    // Simulate an open blocker
    txMock.blockRelation.count.mockResolvedValue(1);

    await expect(
      transitionTicket(undefined, { id: "t1", to: "IN_PROGRESS" }, context)
    ).rejects.toThrow(GraphQLError);

    await expect(
      transitionTicket(undefined, { id: "t1", to: "IN_PROGRESS" }, context)
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("throws INTERNAL_SERVER_ERROR on unexpected DB failure", async () => {
    const { context, txMock } = makeMockContext(mockUser);
    txMock.ticket.findUnique.mockResolvedValue({ id: "t1", state: "REFINED" });
    txMock.blockRelation.count.mockResolvedValue(0);
    txMock.ticket.update.mockRejectedValue(new Error("DB error"));

    await expect(
      transitionTicket(undefined, { id: "t1", to: "IN_PROGRESS" }, context)
    ).rejects.toThrow(GraphQLError);

    await expect(
      transitionTicket(undefined, { id: "t1", to: "IN_PROGRESS" }, context)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });
});
