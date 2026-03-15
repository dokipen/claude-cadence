import { describe, it, expect, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

const { buildAuthContext } = await import("./context.js");
const { signToken } = await import("./jwt.js");

const mockUser = {
  id: "user-1",
  githubId: 1001,
  login: "alice",
  displayName: "Alice",
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeMockPrisma(overrides: {
  revokedTokenResult?: { jti: string } | null;
  userResult?: typeof mockUser | null;
} = {}) {
  return {
    revokedToken: {
      findUnique: vi.fn().mockResolvedValue(overrides.revokedTokenResult ?? null),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(overrides.userResult ?? mockUser),
    },
  } as any;
}

describe("buildAuthContext", () => {
  it("should return null user when no Authorization header", async () => {
    const prisma = makeMockPrisma();
    const result = await buildAuthContext({ headers: {} }, prisma);
    expect(result.currentUser).toBeNull();
  });

  it("should return null user for non-Bearer token", async () => {
    const prisma = makeMockPrisma();
    const result = await buildAuthContext(
      { headers: { authorization: "Basic abc123" } },
      prisma
    );
    expect(result.currentUser).toBeNull();
  });

  it("should return null user for invalid token", async () => {
    const prisma = makeMockPrisma();
    const result = await buildAuthContext(
      { headers: { authorization: "Bearer invalid-token" } },
      prisma
    );
    expect(result.currentUser).toBeNull();
  });

  it("should return user for valid token", async () => {
    const prisma = makeMockPrisma();
    const token = signToken("user-1");
    const result = await buildAuthContext(
      { headers: { authorization: `Bearer ${token}` } },
      prisma
    );
    expect(result.currentUser).toEqual(mockUser);
    expect(result.accessToken).toBe(token);
  });

  it("should reject a revoked token", async () => {
    const token = signToken("user-1");
    const prisma = makeMockPrisma({
      revokedTokenResult: { jti: "some-jti" },
    });
    const result = await buildAuthContext(
      { headers: { authorization: `Bearer ${token}` } },
      prisma
    );
    expect(result.currentUser).toBeNull();
  });

  it("should return null when user not found in database", async () => {
    const prisma = makeMockPrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const token = signToken("nonexistent-user");
    const result = await buildAuthContext(
      { headers: { authorization: `Bearer ${token}` } },
      prisma
    );
    expect(result.currentUser).toBeNull();
  });
});
