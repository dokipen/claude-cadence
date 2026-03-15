import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock graphql-request
const mockRequest = vi.fn();
vi.mock("graphql-request", () => ({
  GraphQLClient: class {
    request = mockRequest;
  },
  gql: (strings: TemplateStringsArray) => strings.join(""),
}));

// Mock config
vi.mock("./config.js", () => ({
  getApiUrl: () => "http://localhost:4000",
  getAuthToken: () => "test-token",
  getRefreshToken: () => null,
  setAuthTokens: () => {},
}));

// Mock project-resolver (for isCuid export)
vi.mock("./project-resolver.js", () => ({
  isCuid: (value: string) => /^c[a-z0-9]{24,}$/.test(value),
  resolveProjectId: vi.fn(),
}));

const { resolveLabelId, resolveLabelIds } = await import("./resolve-label.js");

describe("resolveLabelId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns CUIDs directly without querying", async () => {
    const cuid = "cmms2j38b0009o601cui5c23i";
    const result = await resolveLabelId(cuid);
    expect(result).toBe(cuid);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("resolves label name to ID (case-insensitive)", async () => {
    mockRequest.mockResolvedValue({
      labels: [
        { id: "label-1", name: "bug" },
        { id: "label-2", name: "enhancement" },
      ],
    });

    const result = await resolveLabelId("Enhancement");
    expect(result).toBe("label-2");
  });

  it("resolves exact case match", async () => {
    mockRequest.mockResolvedValue({
      labels: [
        { id: "label-1", name: "bug" },
        { id: "label-2", name: "enhancement" },
      ],
    });

    const result = await resolveLabelId("bug");
    expect(result).toBe("label-1");
  });

  it("throws with guidance when not found", async () => {
    mockRequest.mockResolvedValue({
      labels: [
        { id: "label-1", name: "bug" },
        { id: "label-2", name: "enhancement" },
      ],
    });

    await expect(resolveLabelId("nonexistent")).rejects.toThrow(
      'Label not found: "nonexistent". Run "issues label list" to see available labels.',
    );
  });
});

describe("resolveLabelIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves multiple labels in a single fetch", async () => {
    mockRequest.mockResolvedValue({
      labels: [
        { id: "label-1", name: "bug" },
        { id: "label-2", name: "enhancement" },
      ],
    });

    const result = await resolveLabelIds(["bug", "enhancement"]);
    expect(result).toEqual(["label-1", "label-2"]);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("skips fetch when all inputs are CUIDs", async () => {
    const cuid1 = "cmms2j38b0009o601cui5c23i";
    const cuid2 = "cmms2j38b0009o601cui5c24j";

    const result = await resolveLabelIds([cuid1, cuid2]);
    expect(result).toEqual([cuid1, cuid2]);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("mixes CUIDs and names", async () => {
    const cuid = "cmms2j38b0009o601cui5c23i";
    mockRequest.mockResolvedValue({
      labels: [{ id: "label-1", name: "bug" }],
    });

    const result = await resolveLabelIds([cuid, "bug"]);
    expect(result).toEqual([cuid, "label-1"]);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
