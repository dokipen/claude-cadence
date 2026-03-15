import type { PrismaClient, Ticket, Comment, Prisma, User } from "@prisma/client";
import type { Loaders } from "../../loaders.js";
import { validateTransition, checkBlockerGuard } from "../../fsm/ticket-machine.js";
import { GraphQLError } from "graphql";
import { requireAuth } from "./auth.js";

export interface Context {
  prisma: PrismaClient;
  loaders: Loaders;
  currentUser: User | null;
}

const VALID_STATES = new Set(["BACKLOG", "REFINED", "IN_PROGRESS", "CLOSED"]);
const VALID_PRIORITIES = new Set(["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"]);
const MAX_PAGE_SIZE = 100;

export const ticketResolvers = {
  Query: {
    ticket: async (_: unknown, { id }: { id: string }, { prisma }: Context) => {
      return prisma.ticket.findUnique({ where: { id } });
    },

    ticketByNumber: async (
      _: unknown,
      { projectId, number }: { projectId: string; number: number },
      { prisma }: Context
    ) => {
      return prisma.ticket.findUnique({
        where: { projectId_number: { projectId, number } },
      });
    },

    tickets: async (
      _: unknown,
      args: {
        state?: string;
        labelName?: string;
        assigneeLogin?: string;
        isBlocked?: boolean;
        priority?: string;
        projectId?: string;
        first?: number;
        after?: string;
      },
      { prisma }: Context
    ) => {
      const { state, labelName, assigneeLogin, isBlocked, priority, projectId, after } = args;
      const first = Math.min(args.first ?? 20, MAX_PAGE_SIZE);

      const where: Prisma.TicketWhereInput = {};

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

      if (projectId) {
        where.projectId = projectId;
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

      const queryArgs: Prisma.TicketFindManyArgs = {
        where,
        take: first + 1,
        orderBy: { createdAt: "asc" },
      };

      if (after) {
        queryArgs.cursor = { id: after };
        queryArgs.skip = 1;
      }

      const tickets = await prisma.ticket.findMany(queryArgs);

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

    labels: async (_: unknown, __: unknown, { prisma }: Context) => {
      return prisma.label.findMany({ orderBy: { name: "asc" } });
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
          projectId: string;
          storyPoints?: number;
          priority?: string;
        };
      },
      { prisma }: Context
    ) => {
      const { title, description, acceptanceCriteria, labelIds, assigneeId, projectId, storyPoints, priority } = input;

      if (priority && !VALID_PRIORITIES.has(priority)) {
        throw new Error(`Invalid priority: ${priority}. Must be one of: ${[...VALID_PRIORITIES].join(", ")}`);
      }

      return prisma.$transaction(async (tx) => {
        const project = await tx.project.findUnique({ where: { id: projectId } });
        if (!project) {
          throw new Error(`Project not found: ${projectId}`);
        }

        // Assign next sequential number within the project
        const lastTicket = await tx.ticket.findFirst({
          where: { projectId },
          orderBy: { number: "desc" },
          select: { number: true },
        });
        const nextNumber = (lastTicket?.number ?? 0) + 1;

        const data: Prisma.TicketCreateInput = {
          number: nextNumber,
          title,
          description: description ?? null,
          acceptanceCriteria: acceptanceCriteria ?? null,
          storyPoints: storyPoints ?? null,
          priority: priority ?? "MEDIUM",
          project: { connect: { id: projectId } },
        };

        if (assigneeId) {
          data.assignee = { connect: { id: assigneeId } };
        }

        if (labelIds && labelIds.length > 0) {
          data.labels = {
            create: labelIds.map((labelId: string) => ({
              label: { connect: { id: labelId } },
            })),
          };
        }

        return tx.ticket.create({ data });
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
      if (input.priority && !VALID_PRIORITIES.has(input.priority)) {
        throw new Error(`Invalid priority: ${input.priority}. Must be one of: ${[...VALID_PRIORITIES].join(", ")}`);
      }

      const existing = await prisma.ticket.findUnique({ where: { id } });
      if (!existing) {
        throw new Error(`Ticket not found: ${id}`);
      }

      const data: Prisma.TicketUpdateInput = {};

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

    createLabel: async (
      _: unknown,
      { name, color }: { name: string; color: string },
      { prisma }: Context
    ) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        throw new Error(`Invalid color: ${color}. Must be a hex color (e.g. #ff0000)`);
      }
      return prisma.label.create({ data: { name, color } });
    },

    addLabel: async (
      _: unknown,
      { ticketId, labelId }: { ticketId: string; labelId: string },
      { prisma }: Context
    ) => {
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

      const label = await prisma.label.findUnique({ where: { id: labelId } });
      if (!label) throw new Error(`Label not found: ${labelId}`);

      await prisma.ticketLabel.create({
        data: { ticketId, labelId },
      });
      return ticket;
    },

    removeLabel: async (
      _: unknown,
      { ticketId, labelId }: { ticketId: string; labelId: string },
      { prisma }: Context
    ) => {
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

      const existing = await prisma.ticketLabel.findUnique({
        where: { ticketId_labelId: { ticketId, labelId } },
      });
      if (!existing) throw new Error(`Label ${labelId} is not on ticket ${ticketId}`);

      await prisma.ticketLabel.delete({
        where: { ticketId_labelId: { ticketId, labelId } },
      });
      return ticket;
    },

    assignTicket: async (
      _: unknown,
      { ticketId, userId }: { ticketId: string; userId: string },
      { prisma }: Context
    ) => {
      return prisma.ticket.update({
        where: { id: ticketId },
        data: { assigneeId: userId },
      });
    },

    unassignTicket: async (
      _: unknown,
      { ticketId }: { ticketId: string },
      { prisma }: Context
    ) => {
      return prisma.ticket.update({
        where: { id: ticketId },
        data: { assigneeId: null },
      });
    },

    transitionTicket: async (
      _: unknown,
      { id, to }: { id: string; to: string },
      { prisma }: Context
    ) => {
      return prisma.$transaction(async (tx) => {
        const ticket = await tx.ticket.findUnique({ where: { id } });
        if (!ticket) throw new Error("Ticket not found");

        const transition = validateTransition(ticket.state, to);
        if (!transition.valid) {
          throw new Error(`Invalid transition: ${transition.error}`);
        }

        if (to === "IN_PROGRESS") {
          const guard = await checkBlockerGuard(id, tx as unknown as PrismaClient);
          if (!guard.allowed) {
            throw new Error(guard.error);
          }
        }

        return tx.ticket.update({
          where: { id },
          data: { state: to },
        });
      });
    },

    addBlockRelation: async (
      _: unknown,
      { blockerId, blockedId }: { blockerId: string; blockedId: string },
      { prisma }: Context
    ) => {
      if (blockerId === blockedId) {
        throw new Error("A ticket cannot block itself");
      }

      const blocker = await prisma.ticket.findUnique({ where: { id: blockerId } });
      if (!blocker) throw new Error(`Ticket not found: ${blockerId}`);

      const blocked = await prisma.ticket.findUnique({ where: { id: blockedId } });
      if (!blocked) throw new Error(`Ticket not found: ${blockedId}`);

      await prisma.blockRelation.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      });

      return blocked;
    },

    removeBlockRelation: async (
      _: unknown,
      { blockerId, blockedId }: { blockerId: string; blockedId: string },
      { prisma }: Context
    ) => {
      const existing = await prisma.blockRelation.findUnique({
        where: { blockerId_blockedId: { blockerId, blockedId } },
      });
      if (!existing) throw new Error("Block relation not found");

      await prisma.blockRelation.delete({
        where: { blockerId_blockedId: { blockerId, blockedId } },
      });

      return prisma.ticket.findUniqueOrThrow({ where: { id: blockedId } });
    },

    addComment: async (
      _: unknown,
      { ticketId, body }: { ticketId: string; body: string },
      context: Context
    ) => {
      const user = requireAuth(context);
      if (!body.trim()) throw new Error("Comment body cannot be empty");

      const ticket = await context.prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

      return context.prisma.comment.create({
        data: { ticketId, body, authorId: user.id },
        include: { author: true },
      });
    },

    updateComment: async (
      _: unknown,
      { id, body }: { id: string; body: string },
      context: Context
    ) => {
      const user = requireAuth(context);
      if (!body.trim()) throw new Error("Comment body cannot be empty");

      const existing = await context.prisma.comment.findUnique({ where: { id } });
      if (!existing) throw new Error("Comment not found");

      if (existing.authorId !== user.id) {
        throw new GraphQLError("You can only edit your own comments", {
          extensions: { code: "FORBIDDEN" },
        });
      }

      return context.prisma.comment.update({
        where: { id },
        data: { body },
        include: { author: true },
      });
    },

    deleteComment: async (
      _: unknown,
      { id }: { id: string },
      context: Context
    ) => {
      const user = requireAuth(context);

      const existing = await context.prisma.comment.findUnique({
        where: { id },
        include: { author: true },
      });
      if (!existing) throw new Error("Comment not found");

      if (existing.authorId !== user.id) {
        throw new GraphQLError("You can only delete your own comments", {
          extensions: { code: "FORBIDDEN" },
        });
      }

      await context.prisma.comment.delete({ where: { id } });
      return existing;
    },
  },

  Comment: {
    author: async (parent: Comment, _: unknown, { loaders }: Context) => {
      return loaders.assigneeByUserId.load(parent.authorId);
    },
  },

  Ticket: {
    project: async (parent: Ticket, _: unknown, { loaders }: Context) => {
      const project = await loaders.projectByProjectId.load(parent.projectId);
      if (!project) {
        throw new Error(`Project not found: ${parent.projectId}`);
      }
      return project;
    },

    labels: async (parent: Ticket, _: unknown, { loaders }: Context) => {
      return loaders.labelsByTicketId.load(parent.id);
    },

    comments: async (parent: Ticket, _: unknown, { loaders }: Context) => {
      return loaders.commentsByTicketId.load(parent.id);
    },

    assignee: async (parent: Ticket, _: unknown, { loaders }: Context) => {
      if (!parent.assigneeId) return null;
      return loaders.assigneeByUserId.load(parent.assigneeId);
    },

    blocks: async (parent: Ticket, _: unknown, { loaders }: Context) => {
      return loaders.blocksByTicketId.load(parent.id);
    },

    blockedBy: async (parent: Ticket, _: unknown, { loaders }: Context) => {
      return loaders.blockedByTicketId.load(parent.id);
    },
  },
};
