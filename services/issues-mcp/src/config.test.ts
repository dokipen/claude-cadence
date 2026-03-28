import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:child_process before importing the module under test
const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const {
  getAuthToken,
  getRefreshToken,
  getGhPat,
  setResolvedAuthToken,
  setResolvedRefreshToken,
} = await import("./config.js");

describe("getAuthToken", () => {
  beforeEach(() => {
    setResolvedAuthToken(undefined as any);
    delete process.env.ISSUES_AUTH_TOKEN;
  });

  it("returns env var when ISSUES_AUTH_TOKEN is set", () => {
    process.env.ISSUES_AUTH_TOKEN = "env-token";
    expect(getAuthToken()).toBe("env-token");
  });

  it("falls back to in-memory _resolvedToken when env var is not set", () => {
    setResolvedAuthToken("cached-token");
    expect(getAuthToken()).toBe("cached-token");
  });

  it("returns undefined when neither env var nor cached token is set", () => {
    expect(getAuthToken()).toBeUndefined();
  });

  it("ignores env var that is whitespace-only and falls back to cached token", () => {
    process.env.ISSUES_AUTH_TOKEN = "   ";
    setResolvedAuthToken("cached-token");
    expect(getAuthToken()).toBe("cached-token");
  });
});

describe("getRefreshToken", () => {
  beforeEach(() => {
    setResolvedRefreshToken(undefined as any);
    delete process.env.ISSUES_REFRESH_TOKEN;
  });

  it("returns env var when ISSUES_REFRESH_TOKEN is set", () => {
    process.env.ISSUES_REFRESH_TOKEN = "env-refresh";
    expect(getRefreshToken()).toBe("env-refresh");
  });

  it("falls back to in-memory _resolvedRefreshToken when env var is not set", () => {
    setResolvedRefreshToken("cached-refresh");
    expect(getRefreshToken()).toBe("cached-refresh");
  });

  it("returns undefined when neither env var nor cached refresh token is set", () => {
    expect(getRefreshToken()).toBeUndefined();
  });
});

describe("getGhPat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns trimmed token when gh auth token succeeds", () => {
    mockExecSync.mockReturnValue("ghp_abc123\n");
    expect(getGhPat()).toBe("ghp_abc123");
    expect(mockExecSync).toHaveBeenCalledWith("gh auth token", expect.any(Object));
  });

  it("returns undefined when gh auth token throws", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("gh: command not found");
    });
    expect(getGhPat()).toBeUndefined();
  });

  it("returns undefined when gh auth token returns empty string", () => {
    mockExecSync.mockReturnValue("   ");
    expect(getGhPat()).toBeUndefined();
  });
});

describe("setResolvedAuthToken / setResolvedRefreshToken", () => {
  beforeEach(() => {
    setResolvedAuthToken(undefined as any);
    setResolvedRefreshToken(undefined as any);
    delete process.env.ISSUES_AUTH_TOKEN;
    delete process.env.ISSUES_REFRESH_TOKEN;
  });

  it("setResolvedAuthToken makes getAuthToken return the cached value", () => {
    setResolvedAuthToken("my-token");
    expect(getAuthToken()).toBe("my-token");
  });

  it("setResolvedRefreshToken makes getRefreshToken return the cached value", () => {
    setResolvedRefreshToken("my-refresh");
    expect(getRefreshToken()).toBe("my-refresh");
  });

  it("env var takes precedence over cached auth token", () => {
    setResolvedAuthToken("cached");
    process.env.ISSUES_AUTH_TOKEN = "from-env";
    expect(getAuthToken()).toBe("from-env");
  });

  it("env var takes precedence over cached refresh token", () => {
    setResolvedRefreshToken("cached-refresh");
    process.env.ISSUES_REFRESH_TOKEN = "env-refresh";
    expect(getRefreshToken()).toBe("env-refresh");
  });
});
