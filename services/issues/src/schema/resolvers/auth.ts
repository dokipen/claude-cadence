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
} from "../../auth/jwt.js";
import { GraphQLError } from "graphql";

export interface AuthenticatedContext {
  prisma: PrismaClient;
  loaders: Loaders;
  currentUser: User | null;
}

const oauthProvider = new GitHubOAuthProvider();
const patProvider = new GitHubPATProvider();

async function upsertUser(
  prisma: PrismaClient,
  profile: GitHubUserProfile
): Promise<User> {
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
    authenticateWithGitHubCode: async (
      _: unknown,
      { code }: { code: string },
      { prisma }: AuthenticatedContext
    ) => {
      const profile = await oauthProvider.authenticate({ code });
      const user = await upsertUser(prisma, profile);
      const { token, refreshToken } = await issueTokens(prisma, user.id);
      return { token, refreshToken, user };
    },

    authenticateWithGitHubPAT: async (
      _: unknown,
      { token }: { token: string },
      { prisma }: AuthenticatedContext
    ) => {
      const profile = await patProvider.authenticate({ token });
      const user = await upsertUser(prisma, profile);
      const { token: jwtToken, refreshToken } = await issueTokens(
        prisma,
        user.id
      );
      return { token: jwtToken, refreshToken, user };
    },

    refreshToken: async (
      _: unknown,
      { refreshToken }: { refreshToken: string },
      { prisma }: AuthenticatedContext
    ) => {
      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true },
      });

      if (!storedToken || storedToken.revoked) {
        throw new GraphQLError("Invalid or revoked refresh token", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      if (storedToken.expiresAt < new Date()) {
        throw new GraphQLError("Refresh token expired", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }

      // Rotate: revoke old refresh token, issue new pair
      await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revoked: true },
      });

      const { token, refreshToken: newRefreshToken } = await issueTokens(
        prisma,
        storedToken.userId
      );

      return { token, refreshToken: newRefreshToken, user: storedToken.user };
    },

    logout: async (
      _: unknown,
      { refreshToken }: { refreshToken: string },
      { prisma }: AuthenticatedContext
    ) => {
      // Revoke the refresh token
      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
      });

      if (storedToken && !storedToken.revoked) {
        await prisma.refreshToken.update({
          where: { id: storedToken.id },
          data: { revoked: true },
        });
      }

      return true;
    },
  },
};
