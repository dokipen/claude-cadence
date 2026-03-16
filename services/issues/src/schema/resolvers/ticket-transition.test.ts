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
});
