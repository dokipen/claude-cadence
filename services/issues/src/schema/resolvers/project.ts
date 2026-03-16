import type { PrismaClient, User } from "@prisma/client";
import { GraphQLError } from "graphql";
import type { Loaders } from "../../loaders.js";
import { requireAuth } from "./auth.js";

export interface Context {
  prisma: PrismaClient;
  loaders: Loaders;
  currentUser: User | null;
}

export const projectResolvers = {
  Query: {
    project: async (_: unknown, { id }: { id: string }, { prisma }: Context) => {
      return prisma.project.findUnique({ where: { id } });
    },

    projectByName: async (_: unknown, { name }: { name: string }, { prisma }: Context) => {
      return prisma.project.findUnique({ where: { name } });
    },

    projects: async (_: unknown, __: unknown, { prisma }: Context) => {
      return prisma.project.findMany({ orderBy: { name: "asc" } });
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
        if (error instanceof GraphQLError) throw error;
        console.error("Failed to create project:", error instanceof Error ? error.message : String(error));
        throw new GraphQLError("Failed to create project", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
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
          throw new GraphQLError("Project not found", {
            extensions: { code: "NOT_FOUND" },
          });
        }

        const data: Record<string, string> = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.repository !== undefined) data.repository = input.repository;

        if (Object.keys(data).length === 0) {
          throw new GraphQLError("At least one field to update must be specified", {
            extensions: { code: "BAD_USER_INPUT" },
          });
        }

        return await prisma.project.update({
          where: { id },
          data,
        });
      } catch (error) {
        if (error instanceof GraphQLError) throw error;
        console.error("Failed to update project:", error instanceof Error ? error.message : String(error));
        throw new GraphQLError("Failed to update project", {
          extensions: { code: "INTERNAL_SERVER_ERROR" },
        });
      }
    },
  },
};
