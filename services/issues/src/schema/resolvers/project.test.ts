import { describe, it, expect, vi, beforeAll } from "vitest";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

let project: any;
let projectByName: any;
let projects: any;
let createProject: any;
let updateProject: any;

beforeAll(async () => {
  const mod = await import("./project.js");
  project = mod.projectResolvers.Query.project;
  projectByName = mod.projectResolvers.Query.projectByName;
  projects = mod.projectResolvers.Query.projects;
  createProject = mod.projectResolvers.Mutation.createProject;
  updateProject = mod.projectResolvers.Mutation.updateProject;
});

describe("project — error handling", () => {
  it("wraps Prisma errors in a GraphQLError without leaking details", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        project: {
          findUnique: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: null,
    };

    await expect(
      project(undefined, { id: "some-id" }, ctx)
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

describe("projectByName — error handling", () => {
  it("wraps Prisma errors in a GraphQLError without leaking details", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        project: {
          findUnique: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: null,
    };

    await expect(
      projectByName(undefined, { name: "test-project" }, ctx)
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

describe("projects — error handling", () => {
  it("wraps Prisma errors in a GraphQLError without leaking details", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        project: {
          findMany: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: null,
    };

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

describe("createProject — error handling", () => {
  it("wraps Prisma errors in a GraphQLError without leaking details", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        project: {
          create: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: { id: "user-1", login: "test", displayName: "Test", avatarUrl: null, createdAt: new Date(), updatedAt: new Date() },
    };

    await expect(
      createProject(undefined, { input: { name: "test", repository: "test/repo" } }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to create project",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("createProject mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});

describe("updateProject — error handling", () => {
  it("wraps Prisma errors in a GraphQLError without leaking details", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = {
      prisma: {
        project: {
          findUnique: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        },
      } as any,
      loaders: {} as any,
      currentUser: { id: "user-1", login: "test", displayName: "Test", avatarUrl: null, createdAt: new Date(), updatedAt: new Date() },
    };

    await expect(
      updateProject(undefined, { id: "proj-1", input: { name: "new-name" } }, ctx)
    ).rejects.toMatchObject({
      message: "Failed to update project",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("updateProject mutation failed"),
      expect.any(String)
    );
    consoleSpy.mockRestore();
  });
});
