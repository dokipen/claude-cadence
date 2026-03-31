import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock graphql-request before importing the module under test
const mockRequest = vi.fn();
vi.mock("graphql-request", () => {
  class MockGraphQLClient {
    request = mockRequest;
    constructor() {}
  }
  return {
    GraphQLClient: MockGraphQLClient,
    gql: (strings: TemplateStringsArray) => strings.join(""),
  };
});

vi.mock("../config.js", () => ({
  getApiUrl: () => "http://localhost:4000/graphql",
  getAuthToken: () => "test-token",
  getDefaultProjectId: () => "proj-default",
  getDefaultProjectName: () => undefined,
  setResolvedProjectId: vi.fn(),
}));

vi.mock("../projects.js", () => ({
  resolveProjectName: vi.fn(),
}));

const { ticketCreate, ticketList } = await import("./tickets.js");

// Helper: return the variables passed to the first request call
function capturedVars() {
  return mockRequest.mock.calls[0][1] as Record<string, unknown>;
}

describe("ticketCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockResolvedValue({ createTicket: { id: "t-1", title: "Test" } });
  });

  it("passes labelIds as a proper array when already an array", async () => {
    await ticketCreate({
      title: "Test ticket",
      projectId: "proj-1",
      labelIds: ["label-a", "label-b"],
    });

    const input = capturedVars().input as Record<string, unknown>;
    expect(input.labelIds).toEqual(["label-a", "label-b"]);
  });

  it("normalizes labelIds from a JSON-encoded string to a proper array", async () => {
    // Simulate what the MCP framework sends when it serializes an array as a string
    await ticketCreate({
      title: "Test ticket",
      projectId: "proj-1",
      labelIds: '["label-a","label-b"]' as unknown as string[],
    });

    const input = capturedVars().input as Record<string, unknown>;
    expect(input.labelIds).toEqual(["label-a", "label-b"]);
  });

  it("omits labelIds from input when not provided", async () => {
    await ticketCreate({
      title: "Test ticket",
      projectId: "proj-1",
    });

    const input = capturedVars().input as Record<string, unknown>;
    expect(input).not.toHaveProperty("labelIds");
  });
});

describe("ticketList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockResolvedValue({
      tickets: { edges: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } },
    });
  });

  it("normalizes labelNames from a JSON-encoded string to a proper array", async () => {
    await ticketList({
      labelNames: '["bug","enhancement"]' as unknown as string[],
    });

    const vars = capturedVars();
    expect(vars.labelNames).toEqual(["bug", "enhancement"]);
  });
});
