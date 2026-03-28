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
const mockGetApiUrl = vi.fn().mockReturnValue("http://localhost:4000/graphql");
const mockGetAuthToken = vi.fn();
const mockGetGhPat = vi.fn();
const mockGetRefreshToken = vi.fn();
const mockSetResolvedAuthToken = vi.fn();
const mockSetResolvedRefreshToken = vi.fn();

vi.mock("./config.js", () => ({
  getApiUrl: () => mockGetApiUrl(),
  getAuthToken: () => mockGetAuthToken(),
  getGhPat: () => mockGetGhPat(),
  getRefreshToken: () => mockGetRefreshToken(),
  setResolvedAuthToken: (token: string) => mockSetResolvedAuthToken(token),
  setResolvedRefreshToken: (token: string) => mockSetResolvedRefreshToken(token),
}));

const { bootstrapAuth } = await import("./client.js");

describe("bootstrapAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiUrl.mockReturnValue("http://localhost:4000/graphql");
  });

  it("returns true immediately when getAuthToken already has a value", async () => {
    mockGetAuthToken.mockReturnValue("existing-token");

    const result = await bootstrapAuth();

    expect(result).toBe(true);
    expect(mockGetGhPat).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("returns true and stores tokens when PAT exchange succeeds", async () => {
    mockGetAuthToken.mockReturnValue(undefined);
    mockGetGhPat.mockReturnValue("ghp_test");
    mockRequest.mockResolvedValue({
      authenticateWithGitHubPAT: {
        token: "jwt123",
        refreshToken: "refresh456",
      },
    });

    const result = await bootstrapAuth();

    expect(result).toBe(true);
    expect(mockSetResolvedAuthToken).toHaveBeenCalledWith("jwt123");
    expect(mockSetResolvedRefreshToken).toHaveBeenCalledWith("refresh456");
  });

  it("returns false when getGhPat returns undefined", async () => {
    mockGetAuthToken.mockReturnValue(undefined);
    mockGetGhPat.mockReturnValue(undefined);

    const result = await bootstrapAuth();

    expect(result).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockSetResolvedAuthToken).not.toHaveBeenCalled();
  });

  it("returns false when PAT exchange GraphQL request throws", async () => {
    mockGetAuthToken.mockReturnValue(undefined);
    mockGetGhPat.mockReturnValue("ghp_test");
    mockRequest.mockRejectedValue(new Error("GraphQL request failed"));

    const result = await bootstrapAuth();

    expect(result).toBe(false);
    expect(mockSetResolvedAuthToken).not.toHaveBeenCalled();
    expect(mockSetResolvedRefreshToken).not.toHaveBeenCalled();
  });
});
