import { describe, it, expect, vi } from "vitest";
import { GraphQLError } from "graphql";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

const { projectResolvers } = await import("./project.js");

const { project, projectByName, projects } = projectResolvers.Query;

function makeMockContext() {
  return {
    prisma: {
      project: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    } as any,
    loaders: {} as any,
    currentUser: null,
  };
}

describe("project query", () => {
  it("returns a project by id", async () => {
    const ctx = makeMockContext();
    const proj = { id: "proj-1", name: "my-project" };
    ctx.prisma.project.findUnique.mockResolvedValue(proj);

    const result = await project(undefined, { id: "proj-1" }, ctx);

    expect(result).toEqual(proj);
    expect(ctx.prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: "proj-1" } });
  });

  it("returns null when not found", async () => {
    const ctx = makeMockContext();
    ctx.prisma.project.findUnique.mockResolvedValue(null);

    const result = await project(undefined, { id: "missing" }, ctx);

    expect(result).toBeNull();
  });

  it("wraps DB errors in GraphQLError with INTERNAL_SERVER_ERROR", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeMockContext();
    ctx.prisma.project.findUnique.mockRejectedValue(new Error("DB connection failed"));

    await expect(
      project(undefined, { id: "proj-1" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      project(undefined, { id: "proj-1" }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to fetch project",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("project query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("projectByName query", () => {
  it("returns a project by name", async () => {
    const ctx = makeMockContext();
    const proj = { id: "proj-1", name: "my-project" };
    ctx.prisma.project.findUnique.mockResolvedValue(proj);

    const result = await projectByName(undefined, { name: "my-project" }, ctx);

    expect(result).toEqual(proj);
    expect(ctx.prisma.project.findUnique).toHaveBeenCalledWith({ where: { name: "my-project" } });
  });

  it("returns null when not found", async () => {
    const ctx = makeMockContext();
    ctx.prisma.project.findUnique.mockResolvedValue(null);

    const result = await projectByName(undefined, { name: "missing" }, ctx);

    expect(result).toBeNull();
  });

  it("wraps DB errors in GraphQLError with INTERNAL_SERVER_ERROR", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeMockContext();
    ctx.prisma.project.findUnique.mockRejectedValue(new Error("DB connection failed"));

    await expect(
      projectByName(undefined, { name: "my-project" }, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      projectByName(undefined, { name: "my-project" }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to fetch project by name",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("projectByName query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("projects query", () => {
  it("returns all projects ordered by name", async () => {
    const ctx = makeMockContext();
    const projs = [
      { id: "proj-1", name: "alpha" },
      { id: "proj-2", name: "beta" },
    ];
    ctx.prisma.project.findMany.mockResolvedValue(projs);

    const result = await projects(undefined, {}, ctx);

    expect(result).toEqual(projs);
    expect(ctx.prisma.project.findMany).toHaveBeenCalledWith({ orderBy: { name: "asc" } });
  });

  it("wraps DB errors in GraphQLError with INTERNAL_SERVER_ERROR", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = makeMockContext();
    ctx.prisma.project.findMany.mockRejectedValue(new Error("DB connection failed"));

    await expect(
      projects(undefined, {}, ctx)
    ).rejects.toThrow(GraphQLError);

    await expect(
      projects(undefined, {}, ctx)
    ).rejects.toMatchObject({
      message: "Failed to fetch projects",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("projects query failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});
