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

const { ticketCreate, ticketUpdate, ticketGet, ticketList, ticketTransition } = await import("./tickets.js");

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

  it("wraps a bare string labelId as a single-element array", async () => {
    await ticketCreate({
      title: "Test ticket",
      projectId: "proj-1",
      labelIds: "label-a" as unknown as string[],
    });

    const input = capturedVars().input as Record<string, unknown>;
    expect(input.labelIds).toEqual(["label-a"]);
  });

  it("omits labelIds from input when not provided", async () => {
    await ticketCreate({
      title: "Test ticket",
      projectId: "proj-1",
    });

    const input = capturedVars().input as Record<string, unknown>;
    expect(input).not.toHaveProperty("labelIds");
  });

  it("coerces storyPoints from string to integer", async () => {
    await ticketCreate({
      title: "Test ticket",
      projectId: "proj-1",
      storyPoints: "3" as unknown as number,
    });

    const input = capturedVars().input as Record<string, unknown>;
    expect(input.storyPoints).toBe(3);
  });

  it("passes storyPoints unchanged when already a number", async () => {
    await ticketCreate({
      title: "Test ticket",
      projectId: "proj-1",
      storyPoints: 5,
    });

    const input = capturedVars().input as Record<string, unknown>;
    expect(input.storyPoints).toBe(5);
  });

  it("returns error for non-numeric storyPoints string", async () => {
    const result = await ticketCreate({
      title: "Test ticket",
      projectId: "proj-1",
      storyPoints: "large" as unknown as number,
    });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("storyPoints");
    expect(text).toContain("integer");
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe("ticketList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockResolvedValue({
      tickets: { edges: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } },
    });
  });

  it("passes labelNames as a proper array when already an array", async () => {
    await ticketList({ labelNames: ["bug", "enhancement"] });

    const vars = capturedVars();
    expect(vars.labelNames).toEqual(["bug", "enhancement"]);
  });

  it("normalizes labelNames from a JSON-encoded string to a proper array", async () => {
    await ticketList({
      labelNames: '["bug","enhancement"]' as unknown as string[],
    });

    const vars = capturedVars();
    expect(vars.labelNames).toEqual(["bug", "enhancement"]);
  });

  it("omits labelNames when not provided", async () => {
    await ticketList({});

    const vars = capturedVars();
    expect(vars).not.toHaveProperty("labelNames");
  });
});

describe("ticketTransition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes id and to variables to the GraphQL mutation", async () => {
    mockRequest.mockResolvedValue({
      transitionTicket: { id: "cuid1", number: 1, title: "Test", state: "IN_PROGRESS" },
    });

    const result = await ticketTransition({ id: "cuid1", to: "IN_PROGRESS" });

    expect(result.isError).toBeFalsy();
    const vars = capturedVars();
    expect(vars.id).toBe("cuid1");
    expect(vars.to).toBe("IN_PROGRESS");
  });

  it("normalizes state to uppercase", async () => {
    mockRequest.mockResolvedValue({
      transitionTicket: { id: "cuid1", number: 1, title: "Test", state: "CLOSED" },
    });

    await ticketTransition({ id: "cuid1", to: "closed" });

    expect(capturedVars().to).toBe("CLOSED");
  });

  it("returns error when id is missing", async () => {
    const result = await ticketTransition({ id: "", to: "IN_PROGRESS" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("id is required");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("returns error with valid states list when to is missing", async () => {
    const result = await ticketTransition({ id: "cuid1", to: "" });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("required");
    expect(text).toContain("BACKLOG");
    expect(text).toContain("IN_PROGRESS");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("returns error with valid states list when state is invalid", async () => {
    const result = await ticketTransition({ id: "cuid1", to: "INVALID_STATE" });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("INVALID_STATE");
    expect(text).toContain("BACKLOG");
    expect(text).toContain("REFINED");
    expect(text).toContain("IN_PROGRESS");
    expect(text).toContain("CLOSED");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("augments server enum errors with valid states", async () => {
    mockRequest.mockRejectedValue(
      new Error("Value 'WONTFIX' does not exist in 'TicketState' enum.")
    );

    const result = await ticketTransition({ id: "cuid1", to: "BACKLOG" });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("does not exist in");
    expect(text).toContain("BACKLOG");
    expect(text).toContain("IN_PROGRESS");
  });
});

describe("ticketUpdate storyPoints coercion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockResolvedValue({
      updateTicket: { id: "t-1", number: 1, title: "Test", storyPoints: 3 },
    });
  });

  it("coerces storyPoints from string to integer", async () => {
    await ticketUpdate({ id: "t-1", storyPoints: "3" as unknown as number });

    const vars = capturedVars();
    expect((vars.input as Record<string, unknown>).storyPoints).toBe(3);
  });

  it("passes storyPoints unchanged when already a number", async () => {
    await ticketUpdate({ id: "t-1", storyPoints: 8 });

    const vars = capturedVars();
    expect((vars.input as Record<string, unknown>).storyPoints).toBe(8);
  });

  it("returns error for non-numeric storyPoints string", async () => {
    const result = await ticketUpdate({ id: "t-1", storyPoints: "big" as unknown as number });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("storyPoints");
    expect(text).toContain("integer");
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe("ticketGet number coercion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockResolvedValue({ ticketByNumber: { id: "t-1", number: 42, title: "Test" } });
  });

  it("coerces number from string to integer", async () => {
    await ticketGet({ number: "42" as unknown as number, projectId: "proj-1" });

    const vars = capturedVars();
    expect(vars.number).toBe(42);
  });

  it("returns error for non-numeric number string", async () => {
    const result = await ticketGet({ number: "abc" as unknown as number, projectId: "proj-1" });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("integer");
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
