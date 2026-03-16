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

describe("tickets isBlocked filter", () => {
  it("filters by non-CLOSED blocker state when isBlocked is true", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { isBlocked: true }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.blockedBy).toEqual({
      some: { blocker: { state: { not: "CLOSED" } } },
    });
  });

  it("filters by non-CLOSED blocker state when isBlocked is false", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, { isBlocked: false }, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.blockedBy).toEqual({
      none: { blocker: { state: { not: "CLOSED" } } },
    });
  });

  it("does not add blockedBy filter when isBlocked is undefined", async () => {
    const ctx = makeMockContext([]);
    await tickets(undefined, {}, ctx);

    const call = ctx.prisma.ticket.findMany.mock.calls[0][0];
    expect(call.where.blockedBy).toBeUndefined();
  });
});
