import { describe, it, expect, vi, beforeEach } from "vitest";
import { parse } from "graphql";

/**
 * Helper: imports authGuardPlugin with a fresh module graph so the
 * module-level PUBLIC_FIELDS set picks up the mocked isProduction value.
 */
async function loadGuard(isProduction: boolean) {
  vi.doMock("../env.js", () => ({ isProduction }));
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
