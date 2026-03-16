import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanupExpiredTokens, startCleanupSchedule } from "./cleanup.js";

function makeMockPrisma() {
  return {
    refreshToken: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    revokedToken: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe("cleanupExpiredTokens", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should delete expired refresh tokens and revoked tokens", async () => {
    const prisma = makeMockPrisma();
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 });
    prisma.revokedToken.deleteMany.mockResolvedValue({ count: 5 });

    await cleanupExpiredTokens(prisma as any);

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledOnce();
    expect(prisma.revokedToken.deleteMany).toHaveBeenCalledOnce();

    const refreshWhere = prisma.refreshToken.deleteMany.mock.calls[0][0];
    expect(refreshWhere).toEqual({
      where: { expiresAt: { lt: expect.any(Date) } },
    });

    const revokedWhere = prisma.revokedToken.deleteMany.mock.calls[0][0];
    expect(revokedWhere).toEqual({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });

  it("should use the same cutoff time for both queries", async () => {
    const now = new Date("2026-03-15T12:00:00Z");
    vi.spyOn(globalThis, "Date").mockImplementation(() => now);

    const prisma = makeMockPrisma();
    await cleanupExpiredTokens(prisma as any);

    const refreshCutoff =
      prisma.refreshToken.deleteMany.mock.calls[0][0].where.expiresAt.lt;
    const revokedCutoff =
      prisma.revokedToken.deleteMany.mock.calls[0][0].where.expiresAt.lt;
    expect(refreshCutoff).toBe(revokedCutoff);
    expect(refreshCutoff).toBe(now);
  });

  it("should log when tokens are deleted", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prisma = makeMockPrisma();
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });
    prisma.revokedToken.deleteMany.mockResolvedValue({ count: 7 });

    await cleanupExpiredTokens(prisma as any);

    expect(spy).toHaveBeenCalledWith(
      "Token cleanup: deleted 2 expired refresh tokens, 7 expired revoked tokens"
    );
  });

  it("should not log when no tokens are deleted", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prisma = makeMockPrisma();

    await cleanupExpiredTokens(prisma as any);

    expect(spy).not.toHaveBeenCalled();
  });

  it("should propagate errors from prisma", async () => {
    const prisma = makeMockPrisma();
    prisma.refreshToken.deleteMany.mockRejectedValue(new Error("db error"));

    await expect(cleanupExpiredTokens(prisma as any)).rejects.toThrow(
      "db error"
    );
  });
});

describe("startCleanupSchedule", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  it("should run cleanup immediately on start", async () => {
    const prisma = makeMockPrisma();
    vi.spyOn(console, "error").mockImplementation(() => {});

    startCleanupSchedule(prisma as any);

    // Flush the microtask for the initial async call
    await vi.advanceTimersByTimeAsync(0);

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledOnce();
    expect(prisma.revokedToken.deleteMany).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("should return a timer handle that can be cleared", () => {
    const prisma = makeMockPrisma();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const handle = startCleanupSchedule(prisma as any);
    expect(handle).toBeDefined();
    clearInterval(handle);

    vi.useRealTimers();
  });

  it("should catch and log errors without crashing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prisma = makeMockPrisma();
    prisma.refreshToken.deleteMany.mockRejectedValue(new Error("db down"));

    startCleanupSchedule(prisma as any);
    await vi.advanceTimersByTimeAsync(0);

    expect(errorSpy).toHaveBeenCalledWith(
      "Token cleanup failed:",
      expect.any(Error)
    );

    vi.useRealTimers();
  });
});
