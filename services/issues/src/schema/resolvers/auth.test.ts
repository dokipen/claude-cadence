import { describe, it, expect, vi } from "vitest";
import type { User } from "@prisma/client";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

const { authResolvers } = await import("./auth.js");
const { signToken, verifyToken } = await import("../../auth/jwt.js");

const mockUser: User = {
  id: "user-1",
  githubId: 1001,
  login: "alice",
  displayName: "Alice",
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeMockContext(overrides: {
  currentUser?: User | null;
  accessToken?: string;
  refreshTokenRecord?: any;
  updateManyCount?: number;
} = {}) {
  const refreshTokenCreate = vi.fn().mockResolvedValue({});
  const refreshTokenUpdateMany = vi.fn().mockResolvedValue({
    count: overrides.updateManyCount ?? 1,
  });
  const refreshTokenFindUnique = vi.fn().mockResolvedValue(
    overrides.refreshTokenRecord ?? null
  );
  const revokedTokenCreate = vi.fn().mockResolvedValue({});

  const prisma = {
    refreshToken: {
      create: refreshTokenCreate,
      updateMany: refreshTokenUpdateMany,
      findUnique: refreshTokenFindUnique,
    },
    revokedToken: {
      create: revokedTokenCreate,
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
      return fn(prisma);
    }),
  } as any;

  return {
    context: {
      prisma,
      loaders: {} as any,
      currentUser: overrides.currentUser ?? null,
      accessToken: overrides.accessToken,
    },
    mocks: {
      refreshTokenCreate,
      refreshTokenUpdateMany,
      refreshTokenFindUnique,
      revokedTokenCreate,
    },
  };
}

describe("refreshToken mutation", () => {
  it("should reject an unknown refresh token", async () => {
    const { context } = makeMockContext({ updateManyCount: 0 });

    await expect(
      authResolvers.Mutation.refreshToken(
        {},
        { refreshToken: "unknown-token" },
        context
      )
    ).rejects.toThrow("Invalid or revoked refresh token");
  });

  it("should reject an already-revoked refresh token", async () => {
    const { context } = makeMockContext({ updateManyCount: 0 });

    await expect(
      authResolvers.Mutation.refreshToken(
        {},
        { refreshToken: "revoked-token" },
        context
      )
    ).rejects.toThrow("Invalid or revoked refresh token");
  });

  it("should reject an expired refresh token", async () => {
    const expiredRecord = {
      id: "rt-1",
      token: "valid-token",
      userId: "user-1",
      expiresAt: new Date(Date.now() - 1000), // expired
      revoked: true,
      user: mockUser,
    };

    const { context } = makeMockContext({
      refreshTokenRecord: expiredRecord,
      updateManyCount: 1,
    });

    await expect(
      authResolvers.Mutation.refreshToken(
        {},
        { refreshToken: "valid-token" },
        context
      )
    ).rejects.toThrow("Refresh token expired");
  });

  it("should issue new tokens for a valid refresh token", async () => {
    const validRecord = {
      id: "rt-1",
      token: "valid-token",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 86400000), // 1 day from now
      revoked: false,
      user: mockUser,
    };

    const { context, mocks } = makeMockContext({
      refreshTokenRecord: validRecord,
      updateManyCount: 1,
    });

    const result = await authResolvers.Mutation.refreshToken(
      {},
      { refreshToken: "valid-token" },
      context
    );

    expect(result.token).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.user).toEqual(mockUser);
    // Verify old token was revoked atomically
    expect(mocks.refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: { token: "valid-token", revoked: false },
      data: { revoked: true },
    });
    // Verify new refresh token was created
    expect(mocks.refreshTokenCreate).toHaveBeenCalled();
  });
});

describe("logout mutation", () => {
  it("should revoke the refresh token", async () => {
    const { context, mocks } = makeMockContext();

    const result = await authResolvers.Mutation.logout(
      {},
      { refreshToken: "some-refresh-token" },
      context
    );

    expect(result).toBe(true);
    expect(mocks.refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: { token: "some-refresh-token", revoked: false },
      data: { revoked: true },
    });
  });

  it("should blocklist the current access token on logout", async () => {
    const accessToken = signToken("user-1");
    const { jti } = verifyToken(accessToken);

    const { context, mocks } = makeMockContext({
      currentUser: mockUser,
      accessToken,
    });

    await authResolvers.Mutation.logout(
      {},
      { refreshToken: "some-refresh-token" },
      context
    );

    expect(mocks.revokedTokenCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jti,
        expiresAt: expect.any(Date),
      }),
    });
  });

  it("should succeed even without an access token", async () => {
    const { context, mocks } = makeMockContext();

    const result = await authResolvers.Mutation.logout(
      {},
      { refreshToken: "some-refresh-token" },
      context
    );

    expect(result).toBe(true);
    expect(mocks.revokedTokenCreate).not.toHaveBeenCalled();
  });
});
