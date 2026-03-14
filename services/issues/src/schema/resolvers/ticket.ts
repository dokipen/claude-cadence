import type { PrismaClient, Ticket } from "@prisma/client";

export interface Context {
  prisma: PrismaClient;
}

export const ticketResolvers = {
  Query: {
    ticket: async (_: unknown, { id }: { id: string }, { prisma }: Context) => {
      return prisma.ticket.findUnique({ where: { id } });
    },

    tickets: async (
      _: unknown,
      args: {
        state?: string;
        labelName?: string;
        assigneeLogin?: string;
        isBlocked?: boolean;
        priority?: string;
        first?: number;
        after?: string;
      },
      { prisma }: Context
    ) => {
      const { state, labelName, assigneeLogin, isBlocked, priority, first = 20, after } = args;

      // Build where clause
      const where: Record<string, unknown> = {};

      if (state) {
        where.state = state;
      }

      if (priority) {
        where.priority = priority;
      }

      if (labelName) {
        where.labels = {
          some: {
            label: { name: labelName },
          },
        };
      }

      if (assigneeLogin) {
        where.assignee = {
          login: assigneeLogin,
        };
      }

      if (isBlocked === true) {
        where.blockedBy = {
          some: {},
        };
      } else if (isBlocked === false) {
        where.blockedBy = {
          none: {},
        };
      }

      // Cursor pagination
      const queryArgs: Record<string, unknown> = {
        where,
        take: first + 1, // Fetch one extra to determine hasNextPage
        orderBy: { createdAt: "asc" as const },
      };

      if (after) {
        queryArgs.cursor = { id: after };
        queryArgs.skip = 1; // Skip the cursor item itself
      }

      const tickets = await prisma.ticket.findMany(queryArgs as Parameters<typeof prisma.ticket.findMany>[0]);

      const hasNextPage = tickets.length > first;
      const edges = tickets.slice(0, first).map((ticket: Ticket) => ({
        cursor: ticket.id,
        node: ticket,
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
        },
      };
    },
  },

  Mutation: {
    createTicket: async (
      _: unknown,
      { input }: {
        input: {
          title: string;
          description?: string;
          acceptanceCriteria?: string;
          labelIds?: string[];
          assigneeId?: string;
          storyPoints?: number;
          priority?: string;
        };
      },
      { prisma }: Context
    ) => {
      const { title, description, acceptanceCriteria, labelIds, assigneeId, storyPoints, priority } = input;

      const data: Record<string, unknown> = {
        title,
        description: description ?? null,
        acceptanceCriteria: acceptanceCriteria ?? null,
        storyPoints: storyPoints ?? null,
        priority: priority ?? "MEDIUM",
        assigneeId: assigneeId ?? null,
      };

      if (labelIds && labelIds.length > 0) {
        data.labels = {
          create: labelIds.map((labelId: string) => ({
            label: { connect: { id: labelId } },
          })),
        };
      }

      return prisma.ticket.create({
        data: data as Parameters<typeof prisma.ticket.create>[0]["data"],
      });
    },

    updateTicket: async (
      _: unknown,
      { id, input }: {
        id: string;
        input: {
          title?: string;
          description?: string;
          acceptanceCriteria?: string;
          storyPoints?: number;
          priority?: string;
        };
      },
      { prisma }: Context
    ) => {
      const data: Record<string, unknown> = {};

      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.acceptanceCriteria !== undefined) data.acceptanceCriteria = input.acceptanceCriteria;
      if (input.storyPoints !== undefined) data.storyPoints = input.storyPoints;
      if (input.priority !== undefined) data.priority = input.priority;

      return prisma.ticket.update({
        where: { id },
        data,
      });
    },
  },

  Ticket: {
    labels: async (parent: Ticket, _: unknown, { prisma }: Context) => {
      const ticketLabels = await prisma.ticketLabel.findMany({
        where: { ticketId: parent.id },
        include: { label: true },
      });
      return ticketLabels.map((tl) => tl.label);
    },

    comments: async (parent: Ticket, _: unknown, { prisma }: Context) => {
      return prisma.comment.findMany({
        where: { ticketId: parent.id },
        include: { author: true },
        orderBy: { createdAt: "asc" },
      });
    },

    assignee: async (parent: Ticket, _: unknown, { prisma }: Context) => {
      if (!parent.assigneeId) return null;
      return prisma.user.findUnique({ where: { id: parent.assigneeId } });
    },

    blocks: async (parent: Ticket, _: unknown, { prisma }: Context) => {
      const relations = await prisma.blockRelation.findMany({
        where: { blockerId: parent.id },
        include: { blocked: true },
      });
      return relations.map((r) => r.blocked);
    },

    blockedBy: async (parent: Ticket, _: unknown, { prisma }: Context) => {
      const relations = await prisma.blockRelation.findMany({
        where: { blockedId: parent.id },
        include: { blocker: true },
      });
      return relations.map((r) => r.blocker);
    },
  },
};
