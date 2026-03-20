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

const { getClient, isAuthError, is429Error, getRetryAfterMs } = await import("./client.js");

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

function make429Error(retryAfter?: number) {
  return {
    response: {
      status: 429,
      errors: [{
        message: "Too many requests",
        extensions: {
          code: "TOO_MANY_REQUESTS",
          ...(retryAfter !== undefined ? { retryAfter } : {}),
        },
      }],
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

describe("is429Error", () => {
  it("returns true for error with status 429", () => {
    expect(is429Error(make429Error())).toBe(true);
  });

  it("returns true for error with TOO_MANY_REQUESTS code (no status)", () => {
    const err = {
      response: {
        errors: [{ message: "Too many requests", extensions: { code: "TOO_MANY_REQUESTS" } }],
      },
    };
    expect(is429Error(err)).toBe(true);
  });

  it("returns false for non-429 errors", () => {
    expect(is429Error(makeNonAuthError())).toBe(false);
  });

  it("returns false for null", () => {
    expect(is429Error(null)).toBe(false);
  });

  it("returns false for plain Error", () => {
    expect(is429Error(new Error("something"))).toBe(false);
  });
});

describe("getRetryAfterMs", () => {
  it("returns milliseconds from retryAfter extension", () => {
    expect(getRetryAfterMs(make429Error(5))).toBe(5000);
  });

  it("returns null when no retryAfter present", () => {
    expect(getRetryAfterMs(make429Error())).toBe(null);
  });

  it("returns null for non-positive retryAfter", () => {
    expect(getRetryAfterMs(make429Error(0))).toBe(null);
    expect(getRetryAfterMs(make429Error(-1))).toBe(null);
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

  it("retries on 429 and succeeds on second attempt", async () => {
    mockGetAuthToken.mockReturnValue("valid-token");
    mockRequest
      .mockRejectedValueOnce(make429Error())
      .mockResolvedValueOnce({ data: "success-after-retry" });

    vi.useFakeTimers();
    const client = getClient();
    const promise = client.request("query { me { id } }");
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toEqual({ data: "success-after-retry" });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("retries up to MAX_RETRIES times on 429", async () => {
    mockGetAuthToken.mockReturnValue("valid-token");
    mockRequest
      .mockRejectedValueOnce(make429Error())
      .mockRejectedValueOnce(make429Error())
      .mockRejectedValueOnce(make429Error())
      .mockResolvedValueOnce({ data: "success-after-3-retries" });

    vi.useFakeTimers();
    const client = getClient();
    const promise = client.request("query { me { id } }");
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toEqual({ data: "success-after-3-retries" });
    expect(mockRequest).toHaveBeenCalledTimes(4);
  });

  it("throws after exhausting all retries on 429", async () => {
    mockGetAuthToken.mockReturnValue("valid-token");
    const rateLimitError = make429Error();
    mockRequest
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError);

    vi.useFakeTimers();
    const client = getClient();
    const rejectAssertion = expect(client.request("query { me { id } }")).rejects.toEqual(rateLimitError);
    await vi.runAllTimersAsync();
    await rejectAssertion;
    vi.useRealTimers();

    expect(mockRequest).toHaveBeenCalledTimes(4);
  });

  it("does not retry non-429 errors", async () => {
    mockGetAuthToken.mockReturnValue("valid-token");
    mockGetRefreshToken.mockReturnValue(undefined);
    const serverError = {
      response: {
        status: 500,
        errors: [{ message: "Internal server error", extensions: { code: "INTERNAL_ERROR" } }],
      },
    };
    mockRequest.mockRejectedValueOnce(serverError);

    const client = getClient();
    await expect(client.request("query { me { id } }")).rejects.toEqual(serverError);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it("logs retry message to stderr", async () => {
    mockGetAuthToken.mockReturnValue("valid-token");
    mockRequest
      .mockRejectedValueOnce(make429Error())
      .mockResolvedValueOnce({ data: "ok" });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.useFakeTimers();
    const client = getClient();
    const promise = client.request("query { me { id } }");
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Rate limited")
    );

    errorSpy.mockRestore();
  });
});
