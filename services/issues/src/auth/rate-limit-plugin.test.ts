import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse } from "graphql";
import { RateLimitStore, rateLimitPlugin } from "./rate-limit-plugin.js";

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

const AUTH_MUTATION =
  'mutation { authenticateWithGitHubPAT(token: "x") { token } }';
const REFRESH_MUTATION =
  'mutation { refreshToken(refreshToken: "x") { token } }';
const LOGOUT_MUTATION =
  'mutation { logout(refreshToken: "x") }';
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
    // Retry-after should be time until the oldest timestamp leaves the window
    const retry = store.retryAfterMs("key", 3000, windowMs);
    expect(retry).toBe(58000); // 60000 - (3000 - 1000)
  });

  it("returns 0 retryAfterMs for unknown keys", () => {
    const store = new RateLimitStore();
    expect(store.retryAfterMs("nonexistent", 1000, 60000)).toBe(0);
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
        hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION)),
      ).resolves.toBeUndefined();
    }
  });

  it("blocks auth mutations exceeding the limit", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION));
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION)),
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

  it("applies auth limit to logout mutation", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(LOGOUT_MUTATION));
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(LOGOUT_MUTATION)),
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
        makeRequestContext(AUTH_MUTATION, "10.0.0.1"),
      );
    }
    // ip 10.0.0.1 is rate limited
    await expect(
      hooks.didResolveOperation(
        makeRequestContext(AUTH_MUTATION, "10.0.0.1"),
      ),
    ).rejects.toThrow("Too many requests");
    // ip 10.0.0.2 is still allowed
    await expect(
      hooks.didResolveOperation(
        makeRequestContext(AUTH_MUTATION, "10.0.0.2"),
      ),
    ).resolves.toBeUndefined();
  });

  it("resets after window expires", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION));
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION)),
    ).rejects.toThrow("Too many requests");

    // Advance time past the window
    vi.spyOn(Date, "now").mockReturnValue(1000 + 60001);
    await expect(
      hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION)),
    ).resolves.toBeUndefined();
  });

  it("returns TOO_MANY_REQUESTS error code with retryAfter", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION));
    }
    try {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION));
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.extensions.code).toBe("TOO_MANY_REQUESTS");
      expect(err.extensions.retryAfter).toBeTypeOf("number");
      expect(err.extensions.retryAfter).toBeGreaterThan(0);
      expect(err.extensions.http.status).toBe(429);
    }
  });

  it("logs a warning when rate limit is exceeded", async () => {
    const hooks = await getHooks();
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION));
    }
    try {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION));
    } catch {
      // expected
    }
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Rate limit exceeded"),
    );
  });

  it("handles missing clientIp gracefully", async () => {
    const hooks = await getHooks();
    const ctx = {
      document: parse(AUTH_MUTATION),
      contextValue: { currentUser: null },
    } as any;
    await expect(
      hooks.didResolveOperation(ctx),
    ).resolves.toBeUndefined();
  });

  it("auth and general buckets are independent", async () => {
    const hooks = await getHooks();
    const ip = "10.0.0.1";
    // Exhaust auth limit
    for (let i = 0; i < 3; i++) {
      await hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION, ip));
    }
    await expect(
      hooks.didResolveOperation(makeRequestContext(AUTH_MUTATION, ip)),
    ).rejects.toThrow("Too many requests");
    // General queries from the same IP should still work
    await expect(
      hooks.didResolveOperation(
        makeRequestContext(GENERAL_QUERY, ip, { id: "user-1" }),
      ),
    ).resolves.toBeUndefined();
  });
});
