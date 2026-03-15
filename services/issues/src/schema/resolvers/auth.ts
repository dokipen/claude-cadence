import type { PrismaClient, User } from "@prisma/client";
import type { Loaders } from "../../loaders.js";
import type { GitHubUserProfile } from "../../auth/types.js";
import { GitHubOAuthProvider } from "../../auth/providers/github-oauth.js";
import { GitHubPATProvider } from "../../auth/providers/github-pat.js";
import { signToken } from "../../auth/jwt.js";
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
      const token = signToken(user.id);
      return { token, user };
    },

    authenticateWithGitHubPAT: async (
      _: unknown,
      { token }: { token: string },
      { prisma }: AuthenticatedContext
    ) => {
      const profile = await patProvider.authenticate({ token });
      const user = await upsertUser(prisma, profile);
      const jwtToken = signToken(user.id);
      return { token: jwtToken, user };
    },
  },
};
