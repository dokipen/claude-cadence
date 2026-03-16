import { describe, it, expect, vi } from "vitest";
import { GraphQLError } from "graphql";
import type { User } from "@prisma/client";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

const { projectResolvers } = await import("./project.js");

const mockUser: User = {
  id: "user-1",
  githubId: 1001,
  login: "alice",
  displayName: "Alice",
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeMockContext(currentUser: User | null) {
  return {
    prisma: {
      project: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    } as any,
    loaders: {} as any,
    currentUser,
  };
}

const { createProject, updateProject } = projectResolvers.Mutation;

describe("createProject", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      createProject(undefined, { input: { name: "my-project", repository: "org/repo" } }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("creates a project with valid input", async () => {
    const ctx = makeMockContext(mockUser);
    const project = { id: "proj-1", name: "my-project", repository: "org/repo" };
    ctx.prisma.project.create.mockResolvedValue(project);

    const result = await createProject(
      undefined,
      { input: { name: "my-project", repository: "org/repo" } },
      ctx
    );

    expect(result).toEqual(project);
    expect(ctx.prisma.project.create).toHaveBeenCalledWith({
      data: { name: "my-project", repository: "org/repo" },
    });
  });

  it("throws INTERNAL_SERVER_ERROR on DB failure", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.project.create.mockRejectedValue(new Error("DB error"));

    await expect(
      createProject(undefined, { input: { name: "my-project", repository: "org/repo" } }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      createProject(undefined, { input: { name: "my-project", repository: "org/repo" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });
});

describe("updateProject", () => {
  it("rejects unauthenticated users", async () => {
    const ctx = makeMockContext(null);
    await expect(
      updateProject(undefined, { id: "proj-1", input: { name: "new-name" } }, ctx)
    ).rejects.toThrow("Authentication required");
  });

  it("updates project name", async () => {
    const ctx = makeMockContext(mockUser);
    const existing = { id: "proj-1", name: "old-name", repository: "org/repo" };
    const updated = { id: "proj-1", name: "new-name", repository: "org/repo" };
    ctx.prisma.project.findUnique.mockResolvedValue(existing);
    ctx.prisma.project.update.mockResolvedValue(updated);

    const result = await updateProject(
      undefined,
      { id: "proj-1", input: { name: "new-name" } },
      ctx
    );

    expect(result).toEqual(updated);
    expect(ctx.prisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { name: "new-name" },
    });
  });

  it("updates project repository", async () => {
    const ctx = makeMockContext(mockUser);
    const existing = { id: "proj-1", name: "my-project", repository: "old/repo" };
    const updated = { id: "proj-1", name: "my-project", repository: "new/repo" };
    ctx.prisma.project.findUnique.mockResolvedValue(existing);
    ctx.prisma.project.update.mockResolvedValue(updated);

    const result = await updateProject(
      undefined,
      { id: "proj-1", input: { repository: "new/repo" } },
      ctx
    );

    expect(result).toEqual(updated);
  });

  it("throws NOT_FOUND when project does not exist", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.project.findUnique.mockResolvedValue(null);

    await expect(
      updateProject(undefined, { id: "missing", input: { name: "x" } }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      updateProject(undefined, { id: "missing", input: { name: "x" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("throws BAD_USER_INPUT when no fields are provided", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.project.findUnique.mockResolvedValue({ id: "proj-1", name: "my-project" });

    await expect(
      updateProject(undefined, { id: "proj-1", input: {} }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      updateProject(undefined, { id: "proj-1", input: {} }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("throws INTERNAL_SERVER_ERROR on unexpected DB failure", async () => {
    const ctx = makeMockContext(mockUser);
    ctx.prisma.project.findUnique.mockResolvedValue({ id: "proj-1", name: "my-project" });
    ctx.prisma.project.update.mockRejectedValue(new Error("DB error"));

    await expect(
      updateProject(undefined, { id: "proj-1", input: { name: "new-name" } }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      updateProject(undefined, { id: "proj-1", input: { name: "new-name" } }, ctx)
    ).rejects.toMatchObject({ extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });
});
