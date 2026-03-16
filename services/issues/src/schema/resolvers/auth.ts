import type { PrismaClient, User } from "@prisma/client";
import type { Loaders } from "../../loaders.js";
import type { GitHubUserProfile } from "../../auth/types.js";
import { GitHubOAuthProvider } from "../../auth/providers/github-oauth.js";
import { GitHubPATProvider } from "../../auth/providers/github-pat.js";
import {
  signToken,
  verifyToken,
  generateRefreshToken,
  REFRESH_TOKEN_EXPIRY_DAYS,
  ACCESS_TOKEN_EXPIRY_MS,
} from "../../auth/jwt.js";
import { oauthStateStore } from "../../auth/state-store.js";
import { enforceAllowlist } from "../../auth/allowlist.js";
import { GraphQLError } from "graphql";

export interface AuthenticatedContext {
  prisma: PrismaClient;
  loaders: Loaders;
  currentUser: User | null;
  accessToken?: string;
  clientIp?: string;
}

const oauthProvider = new GitHubOAuthProvider();
const patProvider = new GitHubPATProvider();

async function upsertUser(
  prisma: PrismaClient,
  profile: GitHubUserProfile
): Promise<User> {
  enforceAllowlist(profile.login);
  return prisma.user.upsert({
    where: { githubId: profile.githubId },
    create: {
      githubId: profile.githubId,
      login: profile.login,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    },
    update: {
      login: profile.login,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    },
  });
}

async function issueTokens(prisma: PrismaClient, userId: string) {
  const token = signToken(userId);
  const refreshTokenValue = generateRefreshToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId,
      expiresAt,
    },
  });

  return { token, refreshToken: refreshTokenValue };
}

export function requireAuth(context: AuthenticatedContext): User {
  if (!context.currentUser) {
    throw new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return context.currentUser;
}

export const authResolvers = {
  Query: {
    me: (_: unknown, __: unknown, context: AuthenticatedContext) => {
      requireAuth(context);
      return context.currentUser;
    },
  },

  Mutation: {
    generateOAuthState: () => {
      return oauthStateStore.generate();
    },

    authenticateWithGitHubCode: async (
      _: unknown,
      { code, state }: { code: string; state: string },
      { prisma }: AuthenticatedContext
    ) => {
      if (!oauthStateStore.validate(state)) {
        throw new GraphQLError("Invalid or expired OAuth state parameter", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
      try {
        const profile = await oauthProvider.authenticate({ code });
        const user = await upsertUser(prisma, profile);
        const { token, refreshToken } = await issueTokens(prisma, user.id);
        return { token, refreshToken, user };
      } catch (error) {
        if (error instanceof GraphQLError) throw error;
        console.error("GitHub OAuth authentication failed:", error instanceof Error ? error.message : String(error));
        throw new GraphQLError("Authentication failed", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    },

    authenticateWithGitHubPAT: async (
      _: unknown,
      { token }: { token: string },
      { prisma }: AuthenticatedContext
    ) => {
      try {
        const profile = await patProvider.authenticate({ token });
        const user = await upsertUser(prisma, profile);
        const { token: jwtToken, refreshToken } = await issueTokens(
          prisma,
          user.id
        );
        return { token: jwtToken, refreshToken, user };
      } catch (error) {
        if (error instanceof GraphQLError) throw error;
        console.error("GitHub PAT authentication failed:", error instanceof Error ? error.message : String(error));
        throw new GraphQLError("Authentication failed", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    },

    refreshToken: async (
      _: unknown,
      { refreshToken }: { refreshToken: string },
      { prisma }: AuthenticatedContext
    ) => {
      // Atomic rotation: revoke old token and verify it wasn't already revoked
      return prisma.$transaction(async (tx) => {
        const result = await tx.refreshToken.updateMany({
          where: { token: refreshToken, revoked: false },
          data: { revoked: true },
        });

        if (result.count === 0) {
          throw new GraphQLError("Invalid or revoked refresh token", {
            extensions: { code: "UNAUTHENTICATED" },
          });
        }

        const storedToken = await tx.refreshToken.findUnique({
          where: { token: refreshToken },
          include: { user: true },
        });

        if (!storedToken || storedToken.expiresAt < new Date()) {
          throw new GraphQLError("Refresh token expired", {
            extensions: { code: "UNAUTHENTICATED" },
          });
        }

        enforceAllowlist(storedToken.user.login);

        const { token: newAccessToken, refreshToken: newRefreshToken } =
          await issueTokens(tx as unknown as PrismaClient, storedToken.userId);

        return {
          token: newAccessToken,
          refreshToken: newRefreshToken,
          user: storedToken.user,
        };
      });
    },

    logout: async (
      _: unknown,
      { refreshToken }: { refreshToken: string },
      context: AuthenticatedContext
    ) => {
      const { prisma, accessToken } = context;

      // Revoke the refresh token
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken, revoked: false },
        data: { revoked: true },
      });

      // Blocklist the current access token so it cannot be reused
      if (accessToken) {
        try {
          const { jti } = verifyToken(accessToken);
          const expiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY_MS);
          await prisma.revokedToken.create({
            data: { jti, expiresAt },
          });
        } catch {
          // Token may already be expired/invalid — that's fine
        }
      }

      return true;
    },
  },
};
