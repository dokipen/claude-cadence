import { describe, it, expect, vi } from "vitest";
import { validateTransition, checkBlockerGuard } from "./ticket-machine.js";

describe("validateTransition", () => {
  const validTransitions: [string, string][] = [
    ["BACKLOG", "REFINED"],
    ["REFINED", "IN_PROGRESS"],
    ["REFINED", "BACKLOG"],
    ["IN_PROGRESS", "CLOSED"],
    ["IN_PROGRESS", "REFINED"],
    ["CLOSED", "BACKLOG"],
  ];

  it.each(validTransitions)(
    "allows %s -> %s",
    (from, to) => {
      expect(validateTransition(from, to)).toEqual({ valid: true });
    },
  );

  const invalidTransitions: [string, string][] = [
    ["BACKLOG", "CLOSED"],
    ["BACKLOG", "IN_PROGRESS"],
    ["IN_PROGRESS", "BACKLOG"],
    ["CLOSED", "IN_PROGRESS"],
    ["CLOSED", "REFINED"],
  ];

  it.each(invalidTransitions)(
    "rejects %s -> %s",
    (from, to) => {
      const result = validateTransition(from, to);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    },
  );

  it("rejects same-state transitions", () => {
    for (const state of ["BACKLOG", "REFINED", "IN_PROGRESS", "CLOSED"]) {
      const result = validateTransition(state, state);
      expect(result.valid).toBe(false);
      expect(result.error).toBe(`Already in state ${state}`);
    }
  });

  it("lists allowed transitions in error message", () => {
    const result = validateTransition("BACKLOG", "CLOSED");
    expect(result.error).toContain("REFINED");
    expect(result.error).toContain("Allowed transitions:");
  });
});

describe("checkBlockerGuard", () => {
  function mockPrisma(unresolvedCount: number) {
    return {
      blockRelation: {
        count: vi.fn().mockResolvedValue(unresolvedCount),
      },
    } as any;
  }

  it("allows when no blockers exist", async () => {
    const prisma = mockPrisma(0);
    const result = await checkBlockerGuard("ticket-1", prisma);
    expect(result).toEqual({ allowed: true });
  });

  it("allows when all blockers are closed", async () => {
    const prisma = mockPrisma(0);
    const result = await checkBlockerGuard("ticket-1", prisma);
    expect(result).toEqual({ allowed: true });
  });

  it("rejects when some blockers are not closed", async () => {
    const prisma = mockPrisma(2);
    const result = await checkBlockerGuard("ticket-1", prisma);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain("2 unresolved blocker(s)");
  });
});
