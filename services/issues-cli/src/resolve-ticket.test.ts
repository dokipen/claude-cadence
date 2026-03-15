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

// Mock project-resolver
const mockResolveProjectId = vi.fn();
vi.mock("./project-resolver.js", () => ({
  resolveProjectId: (...args: unknown[]) => mockResolveProjectId(...args),
}));

const { resolveTicketId } = await import("./resolve-ticket.js");

describe("resolveTicketId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns CUIDs directly without resolving", async () => {
    const result = await resolveTicketId("cmms2j38b0009o601cui5c23i");
    expect(result).toBe("cmms2j38b0009o601cui5c23i");
    expect(mockResolveProjectId).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("resolves numeric IDs via project and ticketByNumber", async () => {
    mockResolveProjectId.mockResolvedValue("proj-123");
    mockRequest.mockResolvedValue({
      ticketByNumber: { id: "cmms2j38b0009o601cui5c23i" },
    });

    const result = await resolveTicketId("42", "my-project");

    expect(mockResolveProjectId).toHaveBeenCalledWith("my-project");
    expect(mockRequest).toHaveBeenCalled();
    const [query, variables] = mockRequest.mock.calls[0];
    expect(query).toContain("ticketByNumber");
    expect(variables).toEqual({ projectId: "proj-123", number: 42 });
    expect(result).toBe("cmms2j38b0009o601cui5c23i");
  });

  it("throws when ticket number is not found", async () => {
    mockResolveProjectId.mockResolvedValue("proj-123");
    mockRequest.mockResolvedValue({ ticketByNumber: null });

    await expect(resolveTicketId("999")).rejects.toThrow("Ticket not found: 999");
  });

  it("propagates errors from resolveProjectId", async () => {
    mockResolveProjectId.mockRejectedValue(new Error("No project found"));

    await expect(resolveTicketId("42")).rejects.toThrow("No project found");
  });
});
