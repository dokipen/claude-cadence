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
const mockGetApiUrl = vi.fn().mockReturnValue("http://localhost:4000");
const mockGetAuthToken = vi.fn();
const mockGetRefreshToken = vi.fn();
const mockSetAuthTokens = vi.fn();

vi.mock("./config.js", () => ({
  getApiUrl: () => mockGetApiUrl(),
  getAuthToken: () => mockGetAuthToken(),
  getRefreshToken: () => mockGetRefreshToken(),
  setAuthTokens: (...args: unknown[]) => mockSetAuthTokens(...args),
}));

const { getClient, isAuthError } = await import("./client.js");

function makeAuthError() {
  return {
    response: {
      errors: [{ message: "Authentication required", extensions: { code: "UNAUTHENTICATED" } }],
    },
  };
}

function makeNonAuthError() {
  return {
    response: {
      errors: [{ message: "Not found", extensions: { code: "NOT_FOUND" } }],
    },
  };
}

describe("isAuthError", () => {
  it("returns true for UNAUTHENTICATED error", () => {
    expect(isAuthError(makeAuthError())).toBe(true);
  });

  it("returns false for non-auth GraphQL error", () => {
    expect(isAuthError(makeNonAuthError())).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAuthError(null)).toBe(false);
  });

  it("returns false for plain Error", () => {
    expect(isAuthError(new Error("something"))).toBe(false);
  });

  it("returns false for error with empty errors array", () => {
    expect(isAuthError({ response: { errors: [] } })).toBe(false);
  });

  it("returns false for error with no response", () => {
    expect(isAuthError({ message: "network error" })).toBe(false);
  });
});

describe("getClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiUrl.mockReturnValue("http://localhost:4000");
  });

  it("returns data on successful request", async () => {
    mockGetAuthToken.mockReturnValue("valid-token");
    mockRequest.mockResolvedValue({ data: "success" });

    const client = getClient();
    const result = await client.request("query { me { id } }");

    expect(result).toEqual({ data: "success" });
  });

  it("throws non-auth errors without attempting refresh", async () => {
    mockGetAuthToken.mockReturnValue("valid-token");
    mockGetRefreshToken.mockReturnValue("refresh-token");
    mockRequest.mockRejectedValue(makeNonAuthError());

    const client = getClient();
    await expect(client.request("query { me { id } }")).rejects.toEqual(makeNonAuthError());
    expect(mockSetAuthTokens).not.toHaveBeenCalled();
  });

  it("refreshes token and retries on auth error", async () => {
    mockGetAuthToken.mockReturnValue("expired-token");
    mockGetRefreshToken.mockReturnValue("valid-refresh");

    // First call fails with auth error, refresh succeeds, retry succeeds
    mockRequest
      .mockRejectedValueOnce(makeAuthError())
      .mockResolvedValueOnce({
        refreshToken: {
          token: "new-access",
          refreshToken: "new-refresh",
          user: { id: "1", login: "test" },
        },
      })
      .mockResolvedValueOnce({ data: "retry-success" });

    const client = getClient();
    const result = await client.request("query { me { id } }");

    expect(result).toEqual({ data: "retry-success" });
    expect(mockSetAuthTokens).toHaveBeenCalledWith("new-access", "new-refresh");
  });

  it("throws original error when no refresh token available", async () => {
    mockGetAuthToken.mockReturnValue("expired-token");
    mockGetRefreshToken.mockReturnValue(undefined);

    const authError = makeAuthError();
    mockRequest.mockRejectedValue(authError);

    const client = getClient();
    await expect(client.request("query { me { id } }")).rejects.toEqual(authError);
    expect(mockSetAuthTokens).not.toHaveBeenCalled();
  });

  it("works with no initial auth token (unauthenticated client)", async () => {
    mockGetAuthToken.mockReturnValue(undefined);
    mockRequest.mockResolvedValue({ data: "public" });

    const client = getClient();
    const result = await client.request("query { publicField }");

    expect(result).toEqual({ data: "public" });
  });

  it("throws original error when refresh mutation fails", async () => {
    mockGetAuthToken.mockReturnValue("expired-token");
    mockGetRefreshToken.mockReturnValue("expired-refresh");

    const authError = makeAuthError();
    mockRequest
      .mockRejectedValueOnce(authError)
      .mockRejectedValueOnce(new Error("refresh failed"));

    const client = getClient();
    await expect(client.request("query { me { id } }")).rejects.toEqual(authError);
    expect(mockSetAuthTokens).not.toHaveBeenCalled();
  });
});
