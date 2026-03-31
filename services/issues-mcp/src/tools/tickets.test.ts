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

// Mock config
vi.mock("../config.js", () => ({
  getApiUrl: () => "http://localhost:4000/graphql",
  getAuthToken: () => "test-token",
  getRefreshToken: () => undefined,
  getGhPat: () => undefined,
  setResolvedAuthToken: vi.fn(),
  setResolvedRefreshToken: vi.fn(),
  getDefaultProjectId: () => "default-project-id",
  getDefaultProjectName: () => undefined,
  setResolvedProjectId: vi.fn(),
  getCachedProjectIdByName: () => undefined,
  cacheProjectIdByName: vi.fn(),
}));

// Mock projects
vi.mock("../projects.js", () => ({
  resolveProjectName: vi.fn().mockResolvedValue("resolved-project-id"),
}));

const { ticketCreate, ticketTransition } = await import("./tickets.js");

describe("ticketCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes labelIds as an array when given a real array", async () => {
    mockRequest.mockResolvedValue({ createTicket: { id: "cuid1", title: "Test" } });

    const result = await ticketCreate({
      title: "Test ticket",
      labelIds: ["label-id-1", "label-id-2"],
    });

    expect(result.isError).toBeFalsy();
    const call = mockRequest.mock.calls[0];
    const variables = call[1] as { input: Record<string, unknown> };
    expect(variables.input.labelIds).toEqual(["label-id-1", "label-id-2"]);
  });

  it("parses labelIds from a JSON-encoded string", async () => {
    mockRequest.mockResolvedValue({ createTicket: { id: "cuid1", title: "Test" } });

    const result = await ticketCreate({
      title: "Test ticket",
      // Simulate Claude serializing the array as a JSON string
      labelIds: '["label-id-1", "label-id-2"]' as unknown as string[],
    });

    expect(result.isError).toBeFalsy();
    const call = mockRequest.mock.calls[0];
    const variables = call[1] as { input: Record<string, unknown> };
    expect(variables.input.labelIds).toEqual(["label-id-1", "label-id-2"]);
  });

  it("returns error when labelIds is an invalid JSON string", async () => {
    const result = await ticketCreate({
      title: "Test ticket",
      labelIds: "not-valid-json" as unknown as string[],
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("labelIds must be an array");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("returns error when labelIds parses to a non-array JSON value", async () => {
    const result = await ticketCreate({
      title: "Test ticket",
      labelIds: '"just-a-string"' as unknown as string[],
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("labelIds must be an array");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("returns error when labelIds parses to an array of non-strings", async () => {
    const result = await ticketCreate({
      title: "Test ticket",
      labelIds: "[1, 2, 3]" as unknown as string[],
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("labelIds must be an array");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("omits labelIds from input when not provided", async () => {
    mockRequest.mockResolvedValue({ createTicket: { id: "cuid1", title: "Test" } });

    await ticketCreate({ title: "Test ticket" });

    const call = mockRequest.mock.calls[0];
    const variables = call[1] as { input: Record<string, unknown> };
    expect(variables.input.labelIds).toBeUndefined();
  });

  it("omits labelIds from input when given an empty array", async () => {
    mockRequest.mockResolvedValue({ createTicket: { id: "cuid1", title: "Test" } });

    await ticketCreate({ title: "Test ticket", labelIds: [] });

    const call = mockRequest.mock.calls[0];
    const variables = call[1] as { input: Record<string, unknown> };
    expect(variables.input.labelIds).toBeUndefined();
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
    const call = mockRequest.mock.calls[0];
    const variables = call[1] as Record<string, string>;
    expect(variables.id).toBe("cuid1");
    expect(variables.to).toBe("IN_PROGRESS");
  });

  it("normalizes state to uppercase", async () => {
    mockRequest.mockResolvedValue({
      transitionTicket: { id: "cuid1", number: 1, title: "Test", state: "CLOSED" },
    });

    await ticketTransition({ id: "cuid1", to: "closed" });

    const call = mockRequest.mock.calls[0];
    const variables = call[1] as Record<string, string>;
    expect(variables.to).toBe("CLOSED");
  });

  it("returns error with valid states list when id is missing", async () => {
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
