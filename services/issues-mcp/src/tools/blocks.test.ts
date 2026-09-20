import { describe, it, expect, vi, beforeEach } from "vitest";

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
  resolveProjectName: vi.fn(async () => "proj-resolved"),
}));

const { ticketBlockAdd, ticketBlockRemove } = await import("./blocks.js");
const { resolveProjectName } = await import("../projects.js");

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0].text ?? "";
}

describe("ticketBlockAdd", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveProjectName).mockResolvedValue("proj-resolved");
  });

  it("passes CUIDs straight through and returns the updated ticket", async () => {
    mockRequest.mockResolvedValue({ addBlockRelation: { id: "b", blockedBy: [{ id: "a" }], blocks: [] } });

    const result = await ticketBlockAdd({ blockerId: "a", blockedId: "b" });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][1]).toEqual({ blockerId: "a", blockedId: "b" });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result)).blockedBy).toEqual([{ id: "a" }]);
  });

  it("resolves ticket numbers using the default project", async () => {
    mockRequest
      .mockResolvedValueOnce({ ticketByNumber: { id: "id-147" } })
      .mockResolvedValueOnce({ ticketByNumber: { id: "id-148" } })
      .mockResolvedValueOnce({ addBlockRelation: { id: "id-148" } });

    await ticketBlockAdd({ blockerNumber: 147, blockedNumber: "148" });

    expect(mockRequest.mock.calls[0][1]).toEqual({ projectId: "proj-default", number: 147 });
    expect(mockRequest.mock.calls[1][1]).toEqual({ projectId: "proj-default", number: 148 });
    expect(mockRequest.mock.calls[2][1]).toEqual({ blockerId: "id-147", blockedId: "id-148" });
  });

  it("returns a clear error when a ticket number is not found", async () => {
    mockRequest.mockResolvedValueOnce({ ticketByNumber: null });

    const result = await ticketBlockAdd({ blockerNumber: 999, blockedId: "b" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Blocker ticket #999 not found");
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("errors when neither id nor number is given", async () => {
    const result = await ticketBlockAdd({ blockedId: "b" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("blockerId or blockerNumber is required");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("errors when both id and number are given", async () => {
    const result = await ticketBlockAdd({ blockerId: "a", blockerNumber: 1, blockedId: "b" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not both");
  });

  it("errors on a non-integer number", async () => {
    const result = await ticketBlockAdd({ blockerNumber: "abc", blockedId: "b" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("must be an integer");
  });

  it("surfaces API errors", async () => {
    mockRequest.mockRejectedValue(new Error("A ticket cannot block itself"));

    const result = await ticketBlockAdd({ blockerId: "a", blockedId: "a" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("A ticket cannot block itself");
  });

  it("returns a clear error when the blocked ticket number is not found", async () => {
    mockRequest.mockResolvedValueOnce({ ticketByNumber: null });

    const result = await ticketBlockAdd({ blockerId: "a", blockedNumber: 998 });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Blocked ticket #998 not found");
  });

  it("errors when the blocked side has neither id nor number", async () => {
    const result = await ticketBlockAdd({ blockerId: "a" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("blockedId or blockedNumber is required");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("errors when the blocked side has both id and number", async () => {
    const result = await ticketBlockAdd({ blockerId: "a", blockedId: "b", blockedNumber: 2 });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("blockedId OR blockedNumber");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("rejects floats without calling the API", async () => {
    const result = await ticketBlockAdd({ blockerNumber: 1.5, blockedId: "b" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("must be an integer");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("rejects an empty id without calling the API", async () => {
    const result = await ticketBlockAdd({ blockerId: "", blockedId: "b" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("blockerId must be a non-empty string");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("uses an explicit projectId over the default", async () => {
    mockRequest
      .mockResolvedValueOnce({ ticketByNumber: { id: "x" } })
      .mockResolvedValueOnce({ addBlockRelation: {} });

    await ticketBlockAdd({ blockerNumber: 1, blockedId: "b", projectId: "proj-explicit" });

    expect(mockRequest.mock.calls[0][1]).toEqual({ projectId: "proj-explicit", number: 1 });
  });

  it("resolves projectName when projectId is absent", async () => {
    mockRequest
      .mockResolvedValueOnce({ ticketByNumber: { id: "x" } })
      .mockResolvedValueOnce({ addBlockRelation: {} });

    await ticketBlockAdd({ blockerNumber: 1, blockedId: "b", projectName: "my-proj" });

    expect(resolveProjectName).toHaveBeenCalledWith("my-proj");
    expect(mockRequest.mock.calls[0][1]).toEqual({ projectId: "proj-resolved", number: 1 });
  });

  it("stringifies non-Error rejections", async () => {
    mockRequest.mockRejectedValue("boom");

    const result = await ticketBlockAdd({ blockerId: "a", blockedId: "b" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("boom");
  });
});

describe("ticketBlockRemove", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveProjectName).mockResolvedValue("proj-resolved");
  });

  it("calls removeBlockRelation and returns the updated ticket", async () => {
    mockRequest.mockResolvedValue({ removeBlockRelation: { id: "b", blockedBy: [], blocks: [] } });

    const result = await ticketBlockRemove({ blockerId: "a", blockedId: "b" });

    expect(mockRequest.mock.calls[0][0]).toContain("removeBlockRelation");
    expect(JSON.parse(text(result)).blockedBy).toEqual([]);
  });

  it("resolves numbers and surfaces errors", async () => {
    mockRequest
      .mockResolvedValueOnce({ ticketByNumber: { id: "id-1" } })
      .mockResolvedValueOnce({ ticketByNumber: { id: "id-2" } })
      .mockRejectedValueOnce(new Error("Relation not found"));

    const result = await ticketBlockRemove({ blockerNumber: 1, blockedNumber: 2 });

    expect(mockRequest.mock.calls[2][1]).toEqual({ blockerId: "id-1", blockedId: "id-2" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Relation not found");
  });
});
