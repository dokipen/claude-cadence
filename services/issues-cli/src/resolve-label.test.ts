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
vi.mock("./project-resolver.js", async () => {
  const actual = await vi.importActual<typeof import("./project-resolver.js")>("./project-resolver.js");
  return {
    ...actual,
    resolveProjectId: vi.fn(),
  };
});

const { resolveLabelId } = await import("./resolve-label.js");

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

  it("throws with available labels when not found", async () => {
    mockRequest.mockResolvedValue({
      labels: [
        { id: "label-1", name: "bug" },
        { id: "label-2", name: "enhancement" },
      ],
    });

    await expect(resolveLabelId("nonexistent")).rejects.toThrow(
      'Label not found: "nonexistent". Available labels: bug, enhancement',
    );
  });
});
