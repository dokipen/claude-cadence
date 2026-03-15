import type { PrismaClient } from "@prisma/client";
import type { Loaders } from "../../loaders.js";
import type { User } from "@prisma/client";

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

    projects: async (_: unknown, __: unknown, { prisma }: Context) => {
      return prisma.project.findMany({ orderBy: { name: "asc" } });
    },
  },

  Mutation: {
    createProject: async (
      _: unknown,
      { input }: { input: { name: string; repository: string } },
      { prisma }: Context
    ) => {
      return prisma.project.create({
        data: {
          name: input.name,
          repository: input.repository,
        },
      });
    },

    updateProject: async (
      _: unknown,
      { id, input }: { id: string; input: { name?: string; repository?: string } },
      { prisma }: Context
    ) => {
      const existing = await prisma.project.findUnique({ where: { id } });
      if (!existing) {
        throw new Error(`Project not found: ${id}`);
      }

      const data: Record<string, string> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.repository !== undefined) data.repository = input.repository;

      return prisma.project.update({
        where: { id },
        data,
      });
    },
  },
};
