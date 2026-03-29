import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock client before importing the module under test
const mockRequest = vi.fn();
vi.mock("./client.js", () => ({
  getClient: () => ({ request: mockRequest }),
}));

// Mock config cache helpers
const mockGetCachedProjectIdByName = vi.fn();
const mockCacheProjectIdByName = vi.fn();
vi.mock("./config.js", () => ({
  getCachedProjectIdByName: (name: string) => mockGetCachedProjectIdByName(name),
  cacheProjectIdByName: (name: string, id: string) => mockCacheProjectIdByName(name, id),
}));

const { resolveProjectName } = await import("./projects.js");

describe("resolveProjectName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached CUID without making a GraphQL call when name is already cached", async () => {
    mockGetCachedProjectIdByName.mockReturnValue("cuid_cached_123");

    const result = await resolveProjectName("foo");

    expect(result).toBe("cuid_cached_123");
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockCacheProjectIdByName).not.toHaveBeenCalled();
  });

  it("calls GraphQL, returns the ID, and caches it on cache miss", async () => {
    mockGetCachedProjectIdByName.mockReturnValue(undefined);
    mockRequest.mockResolvedValue({
      projectByName: { id: "cuid_new_456", name: "foo" },
    });

    const result = await resolveProjectName("foo");

    expect(result).toBe("cuid_new_456");
    expect(mockRequest).toHaveBeenCalledOnce();
    expect(mockCacheProjectIdByName).toHaveBeenCalledWith("foo", "cuid_new_456");

    // Second call: simulate cache now populated by returning the cached value
    mockGetCachedProjectIdByName.mockReturnValue("cuid_new_456");

    const result2 = await resolveProjectName("foo");
    expect(result2).toBe("cuid_new_456");
    // request should still have been called only once (no second network call)
    expect(mockRequest).toHaveBeenCalledOnce();
  });

  it("throws 'Project not found' when GraphQL returns projectByName: null", async () => {
    mockGetCachedProjectIdByName.mockReturnValue(undefined);
    mockRequest.mockResolvedValue({ projectByName: null });

    await expect(resolveProjectName("foo")).rejects.toThrow('Project not found: "foo"');
    expect(mockCacheProjectIdByName).not.toHaveBeenCalled();
  });
});
