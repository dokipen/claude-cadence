import DataLoader from "dataloader";
import type { PrismaClient, Label, User, Ticket, Comment } from "@prisma/client";

export interface Loaders {
  labelsByTicketId: DataLoader<string, Label[]>;
  commentsByTicketId: DataLoader<string, (Comment & { author: User })[]>;
  assigneeByUserId: DataLoader<string, User | null>;
  blocksByTicketId: DataLoader<string, Ticket[]>;
  blockedByTicketId: DataLoader<string, Ticket[]>;
}

export function createLoaders(prisma: PrismaClient): Loaders {
  const labelsByTicketId = new DataLoader<string, Label[]>(async (ticketIds) => {
    const ticketLabels = await prisma.ticketLabel.findMany({
      where: { ticketId: { in: [...ticketIds] } },
      include: { label: true },
    });
    const map = new Map<string, Label[]>();
    for (const tl of ticketLabels) {
      const list = map.get(tl.ticketId) ?? [];
      list.push(tl.label);
      map.set(tl.ticketId, list);
    }
    return ticketIds.map((id) => map.get(id) ?? []);
  });

  const commentsByTicketId = new DataLoader<string, (Comment & { author: User })[]>(
    async (ticketIds) => {
      const comments = await prisma.comment.findMany({
        where: { ticketId: { in: [...ticketIds] } },
        include: { author: true },
        orderBy: { createdAt: "asc" },
      });
      const map = new Map<string, (Comment & { author: User })[]>();
      for (const c of comments) {
        const list = map.get(c.ticketId) ?? [];
        list.push(c);
        map.set(c.ticketId, list);
      }
      return ticketIds.map((id) => map.get(id) ?? []);
    }
  );

  const assigneeByUserId = new DataLoader<string, User | null>(async (userIds) => {
    const users = await prisma.user.findMany({
      where: { id: { in: [...userIds] } },
    });
    const map = new Map<string, User>();
    for (const u of users) {
      map.set(u.id, u);
    }
    return userIds.map((id) => map.get(id) ?? null);
  });

  const blocksByTicketId = new DataLoader<string, Ticket[]>(async (ticketIds) => {
    const relations = await prisma.blockRelation.findMany({
      where: { blockerId: { in: [...ticketIds] } },
      include: { blocked: true },
    });
    const map = new Map<string, Ticket[]>();
    for (const r of relations) {
      const list = map.get(r.blockerId) ?? [];
      list.push(r.blocked);
      map.set(r.blockerId, list);
    }
    return ticketIds.map((id) => map.get(id) ?? []);
  });

  const blockedByTicketId = new DataLoader<string, Ticket[]>(async (ticketIds) => {
    const relations = await prisma.blockRelation.findMany({
      where: { blockedId: { in: [...ticketIds] } },
      include: { blocker: true },
    });
    const map = new Map<string, Ticket[]>();
    for (const r of relations) {
      const list = map.get(r.blockedId) ?? [];
      list.push(r.blocker);
      map.set(r.blockedId, list);
    }
    return ticketIds.map((id) => map.get(id) ?? []);
  });

  return {
    labelsByTicketId,
    commentsByTicketId,
    assigneeByUserId,
    blocksByTicketId,
    blockedByTicketId,
  };
}
