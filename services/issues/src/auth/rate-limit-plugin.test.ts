import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse } from "graphql";
import { RateLimitStore, rateLimitPlugin, loadConfig } from "./rate-limit-plugin.js";

process.env.JWT_SECRET = "test-secret-for-unit-tests";

function makeRequestContext(
  query: string,
  clientIp: string = "192.168.1.1",
  currentUser: { id: string } | null = null,
) {
  return {
    document: parse(query),
    contextValue: { currentUser, clientIp },
  } as any;
}

const AUTH_MUTATION_PAT =
  'mutation { authenticateWithGitHubPAT(token: "x") { token } }';
const AUTH_MUTATION_CODE =
  'mutation { authenticateWithGitHubCode(code: "x", state: "y") { token } }';
const REFRESH_MUTATION =
  'mutation { refreshToken(refreshToken: "x") { token } }';
const LOGOUT_MUTATION =
  'mutation { logout(refreshToken: "x") }';
const GENERATE_STATE_MUTATION =
  "mutation { generateOAuthState }";
const GENERAL_QUERY = "{ me { id } }";

describe("RateLimitStore", () => {
  it("allows requests within the limit", () => {
    const store = new RateLimitStore();
    const now = 1000;
    for (let i = 0; i < 5; i++) {
      expect(store.hit("key", now + i, 60000, 5)).toBe(true);
    }
  });

  it("blocks requests exceeding the limit", () => {
    const store = new RateLimitStore();
    const now = 1000;
    for (let i = 0; i < 5; i++) {
      store.hit("key", now, 60000, 5);
    }
    expect(store.hit("key", now, 60000, 5)).toBe(false);
  });

  it("resets after the window expires", () => {
    const store = new RateLimitStore();
    const windowMs = 60000;
    for (let i = 0; i < 5; i++) {
      store.hit("key", 1000, windowMs, 5);
    }
    expect(store.hit("key", 1000, windowMs, 5)).toBe(false);
    // After window expires, should be allowed again
    expect(store.hit("key", 1000 + windowMs + 1, windowMs, 5)).toBe(true);
  });

  it("tracks different keys independently", () => {
    const store = new RateLimitStore();
    const now = 1000;
    for (let i = 0; i < 5; i++) {
      store.hit("ip-a", now, 60000, 5);
    }
    expect(store.hit("ip-a", now, 60000, 5)).toBe(false);
    expect(store.hit("ip-b", now, 60000, 5)).toBe(true);
  });

  it("computes retryAfterMs correctly", () => {
    const store = new RateLimitStore();
    const windowMs = 60000;
    store.hit("key", 1000, windowMs, 5);
    store.hit("key", 2000, windowMs, 5);
    const retry = store.retryAfterMs("key", 3000, windowMs);
    expect(retry).toBe(58000); // 60000 - (3000 - 1000)
  });

  it("returns 0 retryAfterMs for unknown keys", () => {
    const store = new RateLimitStore();
    expect(store.retryAfterMs("nonexistent", 1000, 60000)).toBe(0);
  });

  it("fails open when store is at max capacity", () => {
    const store = new RateLimitStore();
    // Fill the store to capacity by using private access
    const windows = (store as any).windows as Map<string, any>;
    const maxSize = (store as any).maxSize as number;
    for (let i = 0; i < maxSize; i++) {
      windows.set(`key-${i}`, { timestamps: [Date.now()] });
    }
    // New key should be allowed through (fail open)
    expect(store.hit("new-key", Date.now(), 60000, 5)).toBe(true);
  });
});

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env.RATE_LIMIT_AUTH_MAX = originalEnv.RATE_LIMIT_AUTH_MAX;
    process.env.RATE_LIMIT_GENERAL_MAX = originalEnv.RATE_LIMIT_GENERAL_MAX;
    process.env.RATE_LIMIT_WINDOW_MS = originalEnv.RATE_LIMIT_WINDOW_MS;
  });

  it("uses defaults when env vars are not set", () => {
    delete process.env.RATE_LIMIT_AUTH_MAX;
    delete process.env.RATE_LIMIT_GENERAL_MAX;
    delete process.env.RATE_LIMIT_WINDOW_MS;
    const config = loadConfig();
    expect(config.authMaxRequests).toBe(10);
    expect(config.generalMaxRequests).toBe(100);
    expect(config.windowMs).toBe(60000);
  });

  it("reads values from environment variables", () => {
    process.env.RATE_LIMIT_AUTH_MAX = "20";
    process.env.RATE_LIMIT_GENERAL_MAX = "200";
    process.env.RATE_LIMIT_WINDOW_MS = "120000";
    const config = loadConfig();
    expect(config.authMaxRequests).toBe(20);
    expect(config.generalMaxRequests).toBe(200);
    expect(config.windowMs).toBe(120000);
  });
});

describe("rateLimitPlugin", () => {
  let store: RateLimitStore;
  const config = {
    authMaxRequests: 3,
    generalMaxRequests: 5,
    windowMs: 60000,
  };

  beforeEach(() => {
    store = new RateLimitStore();
    vi.spyOn(Date, "now").mockReturnValue(1000);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    store.stopPurgeSchedule();
    vi.restoreAllMocks();
  });

  async function getHooks() {
    const plugin = rateLimitPlugin(config, store);
    return (plugin as any).requestDidStart!({} as any);
  }

  it("allows auth mutations within the limit", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await expect(
        hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT)),
      ).resolves.toBeUndefined();
    }
  });

  it("blocks auth mutations exceeding the limit", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT));
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT)),
    ).rejects.toThrow("Too many requests");
  });

  it("applies auth limit to authenticateWithGitHubCode", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_CODE));
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_CODE)),
    ).rejects.toThrow("Too many requests");
  });

  it("applies auth limit to refreshToken mutation", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(REFRESH_MUTATION));
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(REFRESH_MUTATION)),
    ).rejects.toThrow("Too many requests");
  });

  it("treats logout as general (not auth-limited)", async () => {
    const hooks = await getHooks();
    // logout uses general bucket, so it gets 5 requests not 3
    for (let i = 0; i < 5; i++) {
      await expect(
        hooks.didResolveOperation(makeRequestContext(LOGOUT_MUTATION)),
      ).resolves.toBeUndefined();
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(LOGOUT_MUTATION)),
    ).rejects.toThrow("Too many requests");
  });

  it("treats generateOAuthState as general (not auth-limited)", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 5; i++) {
      await expect(
        hooks.didResolveOperation(makeRequestContext(GENERATE_STATE_MUTATION)),
      ).resolves.toBeUndefined();
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(GENERATE_STATE_MUTATION)),
    ).rejects.toThrow("Too many requests");
  });

  it("uses general limit for non-auth queries", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 5; i++) {
      await expect(
        hooks.didResolveOperation(
          makeRequestContext(GENERAL_QUERY, "10.0.0.1", { id: "user-1" }),
        ),
      ).resolves.toBeUndefined();
    }
    await expect(
      hooks.didResolveOperation(
        makeRequestContext(GENERAL_QUERY, "10.0.0.1", { id: "user-1" }),
      ),
    ).rejects.toThrow("Too many requests");
  });

  it("tracks different IPs independently", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(
        makeRequestContext(AUTH_MUTATION_PAT, "10.0.0.1"),
      );
    }
    await expect(
      hooks.didResolveOperation(
        makeRequestContext(AUTH_MUTATION_PAT, "10.0.0.1"),
      ),
    ).rejects.toThrow("Too many requests");
    await expect(
      hooks.didResolveOperation(
        makeRequestContext(AUTH_MUTATION_PAT, "10.0.0.2"),
      ),
    ).resolves.toBeUndefined();
  });

  it("resets after window expires", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT));
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT)),
    ).rejects.toThrow("Too many requests");

    vi.spyOn(Date, "now").mockReturnValue(1000 + 60001);
    await expect(
      hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT)),
    ).resolves.toBeUndefined();
  });

  it("returns TOO_MANY_REQUESTS error code with retryAfter", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT));
    }
    try {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT));
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.extensions.code).toBe("TOO_MANY_REQUESTS");
      expect(err.extensions.retryAfter).toBe(60);
      expect(err.extensions.http.status).toBe(429);
    }
  });

  it("logs a warning when rate limit is exceeded", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT));
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT)),
    ).rejects.toThrow("Too many requests");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Rate limit exceeded"),
    );
  });

  it("handles missing clientIp gracefully", async () => {
    const hooks = await getHooks();
    const ctx = {
      document: parse(AUTH_MUTATION_PAT),
      contextValue: { currentUser: null },
    } as any;
    // First request allowed
    await expect(hooks.didResolveOperation(ctx)).resolves.toBeUndefined();
  });

  it("accumulates requests from missing clientIp under 'unknown' key", async () => {
    const hooks = await getHooks();
    const ctx = {
      document: parse(AUTH_MUTATION_PAT),
      contextValue: { currentUser: null },
    } as any;
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(ctx);
    }
    await expect(hooks.didResolveOperation(ctx)).rejects.toThrow(
      "Too many requests",
    );
  });

  it("auth and general buckets are independent", async () => {
    const hooks = await getHooks();
    const ip = "10.0.0.1";
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT, ip));
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION_PAT, ip)),
    ).rejects.toThrow("Too many requests");
    await expect(
      hooks.didResolveOperation(
        makeRequestContext(GENERAL_QUERY, ip, { id: "user-1" }),
      ),
    ).resolves.toBeUndefined();
  });

  it("does not rate-limit query operations matching auth mutation names", async () => {
    const hooks = await getHooks();
    // A query (not mutation) with a field named like an auth mutation
    // should use general limits, not auth limits
    const queryWithAuthName = "{ refreshToken }";
    for (let i = 0; i < 5; i++) {
      await expect(
        hooks.didResolveOperation(makeRequestContext(queryWithAuthName)),
      ).resolves.toBeUndefined();
    }
  });
});
