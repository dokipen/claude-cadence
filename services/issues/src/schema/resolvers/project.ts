import type { PrismaClient, User } from "@prisma/client";
import type { Loaders } from "../../loaders.js";
import { GraphQLError } from "graphql";
import { requireAuth } from "./auth.js";

/** Re-throw application errors with their original message; wrap unknown/database errors generically. */
function rethrowOrWrap(error: unknown, fallbackMessage: string, logPrefix: string): never {
  if (error instanceof GraphQLError) throw error;
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`${logPrefix}:`, msg);
  const code = (error as { code?: string }).code;
  if (code && /^P\d{4}$/.test(code)) {
    throw new GraphQLError(fallbackMessage, { extensions: { code: "INTERNAL_SERVER_ERROR" } });
  }
  throw new GraphQLError(msg, { extensions: { code: "BAD_REQUEST" } });
}

export interface Context {
  prisma: PrismaClient;
  loaders: Loaders;
  currentUser: User | null;
}

export const projectResolvers = {
  Query: {
    project: async (_: unknown, { id }: { id: string }, { prisma }: Context) => {
      try {
        return await prisma.project.findUnique({ where: { id } });
      } catch (error) {
        rethrowOrWrap(error, "Failed to fetch project", "project query failed");
      }
    },

    projectByName: async (_: unknown, { name }: { name: string }, { prisma }: Context) => {
      try {
        return await prisma.project.findUnique({ where: { name } });
      } catch (error) {
        rethrowOrWrap(error, "Failed to fetch project by name", "projectByName query failed");
      }
    },

    projects: async (_: unknown, __: unknown, { prisma }: Context) => {
      try {
        return await prisma.project.findMany({ orderBy: { name: "asc" } });
      } catch (error) {
        rethrowOrWrap(error, "Failed to fetch projects", "projects query failed");
      }
    },
  },

  Mutation: {
    createProject: async (
      _: unknown,
      { input }: { input: { name: string; repository: string } },
      context: Context
    ) => {
      requireAuth(context);
      const { prisma } = context;
      try {
        return await prisma.project.create({
          data: {
            name: input.name,
            repository: input.repository,
          },
        });
      } catch (error) {
        rethrowOrWrap(error, "Failed to create project", "createProject mutation failed");
      }
    },

    updateProject: async (
      _: unknown,
      { id, input }: { id: string; input: { name?: string; repository?: string } },
      context: Context
    ) => {
      requireAuth(context);
      const { prisma } = context;
      try {
        const existing = await prisma.project.findUnique({ where: { id } });
        if (!existing) {
          throw new Error(`Project not found: ${id}`);
        }

        const data: Record<string, string> = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.repository !== undefined) data.repository = input.repository;

        if (Object.keys(data).length === 0) {
          throw new Error("At least one field to update must be specified");
        }

        return await prisma.project.update({
          where: { id },
          data,
        });
      } catch (error) {
        rethrowOrWrap(error, "Failed to update project", "updateProject mutation failed");
      }
    },
  },
};
