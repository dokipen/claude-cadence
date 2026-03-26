import { describe, it, expect, vi, beforeEach } from "vitest";
import { parse } from "graphql";

/**
 * Helper: imports authGuardPlugin with a fresh module graph so the
 * module-level PUBLIC_FIELDS set picks up the mocked isProduction value.
 * Mocks ./context.js with AUTH_BYPASS=false to prevent the real context
 * module from loading jwt.ts (which throws when JWT_SECRET is absent in
 * production).
 */
async function loadGuard(isProduction: boolean) {
  vi.doMock("../env.js", () => ({ isProduction }));
  vi.doMock("./context.js", () => ({ AUTH_BYPASS: false }));
  const { authGuardPlugin } = await import("./guard.js");
  return authGuardPlugin;
}

/**
 * Helper: imports authGuardPlugin with a fresh module graph so the
 * module-level AUTH_BYPASS constant picks up the mocked value from context.
 */
async function loadGuardWithBypass(authBypass: boolean) {
  vi.doMock("../env.js", () => ({ isProduction: true }));
  vi.doMock("./context.js", () => ({ AUTH_BYPASS: authBypass }));
  const { authGuardPlugin } = await import("./guard.js");
  return authGuardPlugin;
}

function makeRequestContext(
  query: string,
  currentUser: { id: string } | null = null,
) {
  return {
    document: parse(query),
    contextValue: { currentUser },
  } as any;
}

describe("authGuardPlugin", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("development mode (isProduction=false)", () => {
    it("allows unauthenticated introspection queries", async () => {
      const authGuardPlugin = await loadGuard(false);
      const plugin = authGuardPlugin();
      const hooks = await (plugin as any).requestDidStart!({} as any);
      await expect(
        hooks.didResolveOperation(
          makeRequestContext("{ __schema { types { name } } }"),
        ),
      ).resolves.toBeUndefined();
    });

    it("allows unauthenticated __type queries", async () => {
      const authGuardPlugin = await loadGuard(false);
      const plugin = authGuardPlugin();
      const hooks = await (plugin as any).requestDidStart!({} as any);
      await expect(
        hooks.didResolveOperation(
          makeRequestContext('{ __type(name: "Query") { name } }'),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("production mode (isProduction=true)", () => {
    it("rejects unauthenticated introspection queries", async () => {
      const authGuardPlugin = await loadGuard(true);
      const plugin = authGuardPlugin();
      const hooks = await (plugin as any).requestDidStart!({} as any);
      await expect(
        hooks.didResolveOperation(
          makeRequestContext("{ __schema { types { name } } }"),
        ),
      ).rejects.toThrow("Authentication required");
    });

    it("rejects unauthenticated __type queries", async () => {
      const authGuardPlugin = await loadGuard(true);
      const plugin = authGuardPlugin();
      const hooks = await (plugin as any).requestDidStart!({} as any);
      await expect(
        hooks.didResolveOperation(
          makeRequestContext('{ __type(name: "Query") { name } }'),
        ),
      ).rejects.toThrow("Authentication required");
    });

    it("allows introspection for authenticated users", async () => {
      const authGuardPlugin = await loadGuard(true);
      const plugin = authGuardPlugin();
      const hooks = await (plugin as any).requestDidStart!({} as any);
      await expect(
        hooks.didResolveOperation(
          makeRequestContext("{ __schema { types { name } } }", {
            id: "user-1",
          }),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("AUTH_BYPASS mode (AUTH_BYPASS=true)", () => {
    it("returns a no-op plugin (no requestDidStart hook)", async () => {
      const authGuardPlugin = await loadGuardWithBypass(true);
      const plugin = authGuardPlugin();
      expect((plugin as any).requestDidStart).toBeUndefined();
    });

    it("allows unauthenticated requests for normally-protected fields", async () => {
      const authGuardPlugin = await loadGuardWithBypass(true);
      const plugin = authGuardPlugin();
      // The plugin has no requestDidStart, so there are no hooks to invoke.
      // Asserting requestDidStart is absent is the correct observable behavior.
      expect((plugin as any).requestDidStart).toBeUndefined();
    });

    it("allows unauthenticated introspection queries", async () => {
      const authGuardPlugin = await loadGuardWithBypass(true);
      const plugin = authGuardPlugin();
      expect((plugin as any).requestDidStart).toBeUndefined();
    });
  });

  describe("AUTH_BYPASS disabled (AUTH_BYPASS=false)", () => {
    it("still enforces authentication in production", async () => {
      const authGuardPlugin = await loadGuardWithBypass(false);
      const plugin = authGuardPlugin();
      const hooks = await (plugin as any).requestDidStart!({} as any);
      await expect(
        hooks.didResolveOperation(
          makeRequestContext("{ __schema { types { name } } }"),
        ),
      ).rejects.toThrow("Authentication required");
    });

    it("still allows authenticated requests in production", async () => {
      const authGuardPlugin = await loadGuardWithBypass(false);
      const plugin = authGuardPlugin();
      const hooks = await (plugin as any).requestDidStart!({} as any);
      await expect(
        hooks.didResolveOperation(
          makeRequestContext("{ __schema { types { name } } }", {
            id: "user-1",
          }),
        ),
      ).resolves.toBeUndefined();
    });
  });

  it("always allows unauthenticated __typename queries (health check)", async () => {
    const authGuardPlugin = await loadGuard(true);
    const plugin = authGuardPlugin();
    const hooks = await (plugin as any).requestDidStart!({} as any);
    await expect(
      hooks.didResolveOperation(makeRequestContext("{ __typename }")),
    ).resolves.toBeUndefined();
  });

  it("always allows unauthenticated auth mutations", async () => {
    const authGuardPlugin = await loadGuard(true);
    const plugin = authGuardPlugin();
    const hooks = await (plugin as any).requestDidStart!({} as any);
    await expect(
      hooks.didResolveOperation(
        makeRequestContext(
          'mutation { authenticateWithGitHubPAT(token: "x") { token } }',
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
