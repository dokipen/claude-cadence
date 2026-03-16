import { describe, it, expect, vi, beforeAll } from "vitest";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

let ticket: any;
let ticketByNumber: any;

beforeAll(async () => {
  const mod = await import("./ticket.js");
  ticket = mod.ticketResolvers.Query.ticket;
  ticketByNumber = mod.ticketResolvers.Query.ticketByNumber;
});

describe("ticket — error handling", () => {
  it("wraps Prisma errors in a GraphQLError without leaking details", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findUnique: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: null,
    };

    await expect(
      ticket(undefined, { id: "some-id" }, ctx)
    ).rejects.toThrow("Failed to fetch ticket");

    // Verify the raw error is not leaked in the thrown message
    try {
      await ticket(undefined, { id: "some-id" }, ctx);
    } catch (e: any) {
      expect(e.message).not.toContain("DB connection failed");
      expect(e.extensions?.code).toBe("INTERNAL_SERVER_ERROR");
    }

    // Verify the error is logged for observability
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("ticketByNumber — error handling", () => {
  it("wraps Prisma errors in a GraphQLError without leaking details", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findUnique: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: null,
    };

    await expect(
      ticketByNumber(undefined, { projectId: "proj-1", number: 1 }, ctx)
    ).rejects.toThrow("Failed to fetch ticket by number");

    // Verify the raw error is not leaked in the thrown message
    try {
      await ticketByNumber(undefined, { projectId: "proj-1", number: 1 }, ctx);
    } catch (e: any) {
      expect(e.message).not.toContain("DB connection failed");
      expect(e.extensions?.code).toBe("INTERNAL_SERVER_ERROR");
    }

    // Verify the error is logged for observability
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
