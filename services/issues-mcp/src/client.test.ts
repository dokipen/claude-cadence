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

const { bootstrapAuth, getClient } = await import("./client.js");

function makeAuthError() {
  return Object.assign(new Error("UNAUTHENTICATED"), {
    response: { errors: [{ extensions: { code: "UNAUTHENTICATED" } }] },
  });
}

describe("getClient — auth retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiUrl.mockReturnValue("http://localhost:4000/graphql");
    mockGetRefreshToken.mockReturnValue(undefined);
    mockGetGhPat.mockReturnValue(undefined);
  });

  it("retries with refreshed token and returns success on UNAUTHENTICATED error", async () => {
    mockGetAuthToken.mockReturnValue("expired-token");
    mockGetRefreshToken.mockReturnValue("refresh-token");
    mockRequest
      .mockRejectedValueOnce(makeAuthError()) // first call with expired token fails
      .mockResolvedValueOnce({ refreshToken: { token: "new-token", refreshToken: "new-refresh" } }) // refresh mutation
      .mockResolvedValueOnce({ data: "ok" }); // retry with new token

    const client = getClient();
    const result = await client.request("query { test }");
    expect(result).toEqual({ data: "ok" });
    expect(mockSetResolvedAuthToken).toHaveBeenCalledWith("new-token");
  });

  it("falls back to gh auth token PAT exchange when refresh token is absent", async () => {
    mockGetAuthToken.mockReturnValue("expired-token");
    mockGetRefreshToken.mockReturnValue(undefined);
    mockGetGhPat.mockReturnValue("ghp_pat");
    mockRequest
      .mockRejectedValueOnce(makeAuthError()) // first call fails
      .mockResolvedValueOnce({ authenticateWithGitHubPAT: { token: "pat-token", refreshToken: "pat-refresh" } }) // PAT exchange
      .mockResolvedValueOnce({ data: "ok" }); // retry

    const client = getClient();
    const result = await client.request("query { test }");
    expect(result).toEqual({ data: "ok" });
    expect(mockSetResolvedAuthToken).toHaveBeenCalledWith("pat-token");
  });

  it("throws a clear actionable error when re-auth fails", async () => {
    mockGetAuthToken.mockReturnValue("expired-token");
    mockGetRefreshToken.mockReturnValue(undefined);
    mockGetGhPat.mockReturnValue(undefined);
    mockRequest.mockRejectedValueOnce(makeAuthError());

    const client = getClient();
    await expect(client.request("query { test }")).rejects.toThrow(
      "Run `gh auth login` to re-authenticate"
    );
  });

  it("throws a clear actionable error on second auth failure (no double-retry)", async () => {
    mockGetAuthToken.mockReturnValue("expired-token");
    mockGetRefreshToken.mockReturnValue("refresh-token");
    mockRequest
      .mockRejectedValueOnce(makeAuthError()) // original request fails
      .mockResolvedValueOnce({ refreshToken: { token: "new-token", refreshToken: "new-refresh" } }) // refresh succeeds
      .mockRejectedValueOnce(makeAuthError()); // retry still fails

    const client = getClient();
    await expect(client.request("query { test }")).rejects.toThrow(
      "Run `gh auth login` to re-authenticate"
    );
  });
});

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
