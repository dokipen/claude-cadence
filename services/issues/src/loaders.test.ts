import { describe, it, expect, vi } from "vitest";
import { createLoaders } from "./loaders.js";

function makeMockPrisma(blockRelationFindManyResult: unknown[] = []) {
  return {
    blockRelation: {
      findMany: vi.fn().mockResolvedValue(blockRelationFindManyResult),
    },
  } as any;
}

describe("blockedByTicketId DataLoader", () => {
  it("queries Prisma with state filter excluding CLOSED blockers", async () => {
    const prisma = makeMockPrisma([]);
    const loaders = createLoaders(prisma);

    await loaders.blockedByTicketId.load("ticket-1");

    const call = prisma.blockRelation.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      blockedId: { in: ["ticket-1"] },
      blocker: { state: { not: "CLOSED" } },
    });
  });

  it("returns only non-CLOSED blockers by applying the state filter", async () => {
    const mockRelations = [
      {
        blockedId: "ticket-1",
        blockerId: "blocker-open",
        blocker: { id: "blocker-open", state: "OPEN", title: "Open blocker" },
      },
    ];
    const prisma = makeMockPrisma(mockRelations);
    const loaders = createLoaders(prisma);

    const result = await loaders.blockedByTicketId.load("ticket-1");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "blocker-open", state: "OPEN" });

    const call = prisma.blockRelation.findMany.mock.calls[0][0];
    expect(call.where.blocker).toEqual({ state: { not: "CLOSED" } });
  });

  it("returns empty array when all blockers are CLOSED", async () => {
    // Prisma enforces the filter server-side; mock returns empty to simulate
    // that all matching relations were excluded by the CLOSED state filter.
    const prisma = makeMockPrisma([]);
    const loaders = createLoaders(prisma);

    const result = await loaders.blockedByTicketId.load("ticket-2");

    expect(result).toEqual([]);

    const call = prisma.blockRelation.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      blockedId: { in: ["ticket-2"] },
      blocker: { state: { not: "CLOSED" } },
    });
  });

  it("batches multiple ticket IDs in a single Prisma call", async () => {
    const mockRelations = [
      {
        blockedId: "ticket-a",
        blockerId: "blocker-1",
        blocker: { id: "blocker-1", state: "OPEN", title: "Blocker 1" },
      },
      {
        blockedId: "ticket-b",
        blockerId: "blocker-2",
        blocker: { id: "blocker-2", state: "IN_PROGRESS", title: "Blocker 2" },
      },
    ];
    const prisma = makeMockPrisma(mockRelations);
    const loaders = createLoaders(prisma);

    const [resultA, resultB] = await Promise.all([
      loaders.blockedByTicketId.load("ticket-a"),
      loaders.blockedByTicketId.load("ticket-b"),
    ]);

    // Both IDs are batched into a single findMany call
    expect(prisma.blockRelation.findMany.mock.calls).toHaveLength(1);

    const call = prisma.blockRelation.findMany.mock.calls[0][0];
    expect(call.where.blockedId.in).toContain("ticket-a");
    expect(call.where.blockedId.in).toContain("ticket-b");
    expect(call.where.blocker).toEqual({ state: { not: "CLOSED" } });

    expect(resultA).toHaveLength(1);
    expect(resultA[0]).toMatchObject({ id: "blocker-1" });
    expect(resultB).toHaveLength(1);
    expect(resultB[0]).toMatchObject({ id: "blocker-2" });
  });
});
