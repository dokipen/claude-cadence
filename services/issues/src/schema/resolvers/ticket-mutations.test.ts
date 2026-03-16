import { describe, it, expect, vi } from "vitest";
import type { User } from "@prisma/client";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

const { ticketResolvers } = await import("./ticket.js");

function makeMockContext(currentUser: User | null) {
  return {
    prisma: {
      ticket: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      label: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      ticketLabel: {
        findUnique: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      blockRelation: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
      },
      project: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn((fn: any) => fn({
        project: { findUnique: vi.fn() },
        ticket: {
          findUnique: vi.fn(),
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
      })),
    } as any,
    loaders: {} as any,
    currentUser,
  };
}

const {
  createTicket,
  updateTicket,
  createLabel,
  addLabel,
  removeLabel,
  assignTicket,
  unassignTicket,
  transitionTicket,
  addBlockRelation,
  removeBlockRelation,
} = ticketResolvers.Mutation;

describe("createTicket", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      createTicket(undefined, { input: { title: "t", projectId: "p1" } }, ctx)
    ).rejects.toThrow("Authentication required");
  });
});

describe("updateTicket", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      updateTicket(undefined, { id: "t1", input: { title: "updated" } }, ctx)
    ).rejects.toThrow("Authentication required");
  });
});

describe("createLabel", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      createLabel(undefined, { name: "bug", color: "#ff0000" }, ctx)
    ).rejects.toThrow("Authentication required");
  });
});

describe("addLabel", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      addLabel(undefined, { ticketId: "t1", labelId: "l1" }, ctx)
    ).rejects.toThrow("Authentication required");
  });
});

describe("removeLabel", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      removeLabel(undefined, { ticketId: "t1", labelId: "l1" }, ctx)
    ).rejects.toThrow("Authentication required");
  });
});

describe("assignTicket", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      assignTicket(undefined, { ticketId: "t1", userId: "u1" }, ctx)
    ).rejects.toThrow("Authentication required");
  });
});

describe("unassignTicket", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      unassignTicket(undefined, { ticketId: "t1" }, ctx)
    ).rejects.toThrow("Authentication required");
  });
});

describe("transitionTicket", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      transitionTicket(undefined, { id: "t1", to: "IN_PROGRESS" }, ctx)
    ).rejects.toThrow("Authentication required");
  });
});

describe("addBlockRelation", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      addBlockRelation(undefined, { blockerId: "t1", blockedId: "t2" }, ctx)
    ).rejects.toThrow("Authentication required");
  });
});

describe("removeBlockRelation", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      removeBlockRelation(undefined, { blockerId: "t1", blockedId: "t2" }, ctx)
    ).rejects.toThrow("Authentication required");
  });
});
