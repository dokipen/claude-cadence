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
          findUnique: vi.fn().mockRejectedValue(Object.assign(new Error("DB connection failed"), { code: "P2010" })),
        },
      } as any,
      loaders: {} as any,
      currentUser: null,
    };

    await expect(
      ticket(undefined, { id: "some-id" }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to fetch ticket",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ticket query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("ticketByNumber — error handling", () => {
  it("wraps Prisma errors in a GraphQLError without leaking details", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        ticket: {
          findUnique: vi.fn().mockRejectedValue(Object.assign(new Error("DB connection failed"), { code: "P2010" })),
        },
      } as any,
      loaders: {} as any,
      currentUser: null,
    };

    await expect(
      ticketByNumber(undefined, { projectId: "proj-1", number: 1 }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to fetch ticket by number",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ticketByNumber query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});
