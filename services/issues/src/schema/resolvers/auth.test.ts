import { describe, it, expect, vi } from "vitest";
import type { User } from "@prisma/client";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

const mockOAuthAuthenticate = vi.fn();
const mockPATAuthenticate = vi.fn();
const mockValidate = vi.fn();

vi.mock("../../auth/providers/github-oauth.js", () => ({
  GitHubOAuthProvider: class {
    authenticate = mockOAuthAuthenticate;
  },
}));

vi.mock("../../auth/providers/github-pat.js", () => ({
  GitHubPATProvider: class {
    authenticate = mockPATAuthenticate;
  },
}));

vi.mock("../../auth/state-store.js", () => ({
  oauthStateStore: {
    generate: vi.fn().mockReturnValue("mock-state"),
    validate: mockValidate,
  },
}));

vi.mock("../../auth/allowlist.js", () => ({
  enforceAllowlist: vi.fn(),
}));

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

describe("refreshToken — error handling", () => {
  it("wraps DB errors in GraphQLError with INTERNAL_SERVER_ERROR", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { context } = makeMockContext();
    context.prisma.$transaction.mockRejectedValue(new Error("DB connection lost"));

    await expect(
      authResolvers.Mutation.refreshToken(
        {},
        { refreshToken: "some-token" },
        context
      )
    ).rejects.toMatchObject({
      message: "Token refresh failed",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Token refresh failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });

  it("re-throws GraphQLError from within the transaction", async () => {
    const { GraphQLError } = await import("graphql");
    const { context } = makeMockContext();
    context.prisma.$transaction.mockRejectedValue(
      new GraphQLError("Invalid or revoked refresh token", {
        extensions: { code: "UNAUTHENTICATED" },
      })
    );

    await expect(
      authResolvers.Mutation.refreshToken(
        {},
        { refreshToken: "some-token" },
        context
      )
    ).rejects.toMatchObject({
      message: "Invalid or revoked refresh token",
      extensions: { code: "UNAUTHENTICATED" },
    });
  });
});

describe("logout — error handling", () => {
  it("wraps DB errors in GraphQLError with INTERNAL_SERVER_ERROR", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { context } = makeMockContext();
    context.prisma.refreshToken.updateMany.mockRejectedValue(
      new Error("DB connection lost")
    );

    await expect(
      authResolvers.Mutation.logout(
        {},
        { refreshToken: "some-token" },
        context
      )
    ).rejects.toMatchObject({
      message: "Logout failed",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Logout failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("authenticateWithGitHubCode — error handling", () => {
  it("wraps provider errors in GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockValidate.mockReturnValue(true);
    mockOAuthAuthenticate.mockRejectedValue(new Error("GitHub API down"));
    const { context } = makeMockContext();

    await expect(
      authResolvers.Mutation.authenticateWithGitHubCode(
        {},
        { code: "test-code", state: "test-state" },
        context
      )
    ).rejects.toMatchObject({
      message: "Authentication failed",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("GitHub OAuth authentication failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });

  it("re-throws GraphQLError from allowlist enforcement", async () => {
    const { GraphQLError } = await import("graphql");
    mockValidate.mockReturnValue(true);
    mockOAuthAuthenticate.mockResolvedValue({
      githubId: 1,
      login: "blocked-user",
      displayName: "Blocked",
      avatarUrl: null,
    });

    const { enforceAllowlist } = await import("../../auth/allowlist.js");
    (enforceAllowlist as any).mockImplementation(() => {
      throw new GraphQLError("User is not authorized to access this application", {
        extensions: { code: "FORBIDDEN" },
      });
    });

    const { context } = makeMockContext();

    await expect(
      authResolvers.Mutation.authenticateWithGitHubCode(
        {},
        { code: "test-code", state: "test-state" },
        context
      )
    ).rejects.toMatchObject({
      message: "User is not authorized to access this application",
      extensions: { code: "FORBIDDEN" },
    });

    (enforceAllowlist as any).mockImplementation(() => {});
  });
});

describe("authenticateWithGitHubPAT — error handling", () => {
  it("wraps provider errors in GraphQLError", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPATAuthenticate.mockRejectedValue(new Error("Invalid PAT"));
    const { context } = makeMockContext();

    await expect(
      authResolvers.Mutation.authenticateWithGitHubPAT(
        {},
        { token: "bad-token" },
        context
      )
    ).rejects.toMatchObject({
      message: "Authentication failed",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("GitHub PAT authentication failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });

  it("re-throws GraphQLError from allowlist enforcement", async () => {
    const { GraphQLError } = await import("graphql");
    mockPATAuthenticate.mockResolvedValue({
      githubId: 2,
      login: "blocked-user",
      displayName: "Blocked",
      avatarUrl: null,
    });

    const { enforceAllowlist } = await import("../../auth/allowlist.js");
    (enforceAllowlist as any).mockImplementation(() => {
      throw new GraphQLError("User is not authorized to access this application", {
        extensions: { code: "FORBIDDEN" },
      });
    });

    const { context } = makeMockContext();

    await expect(
      authResolvers.Mutation.authenticateWithGitHubPAT(
        {},
        { token: "some-token" },
        context
      )
    ).rejects.toMatchObject({
      message: "User is not authorized to access this application",
      extensions: { code: "FORBIDDEN" },
    });

    (enforceAllowlist as any).mockImplementation(() => {});
  });
});
