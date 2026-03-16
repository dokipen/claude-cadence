import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestSuite, type TestSuite } from "./helpers.js";

describe("Auth", () => {
  let suite: TestSuite;

  beforeAll(async () => {
    suite = await setupTestSuite();
  });

  afterAll(() => {
    suite?.cleanup();
  });

  describe("unauthenticated access rejection", () => {
    it("should reject unauthenticated ticket queries", async () => {
      const result = await suite.unauthenticatedCli("ticket", "list");
      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Authentication required");
    });

    it("should reject unauthenticated ticket creation", async () => {
      const result = await suite.unauthenticatedCli("ticket", "create", "--project", "default-project", "--title", "Should fail");
      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Authentication required");
    });

    it("should reject unauthenticated label queries", async () => {
      const result = await suite.unauthenticatedCli("label", "list");
      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Authentication required");
    });
  });

  describe("authenticated access", () => {
    it("should allow authenticated ticket creation", async () => {
      const result = await suite.cli("ticket", "create", "--project", "default-project", "--title", "Auth test ticket");
      expect(result.exitCode).toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Auth test ticket");
    });

    it("should allow authenticated ticket listing", async () => {
      const result = await suite.cli("ticket", "list");
      expect(result.exitCode).toBe(0);
    });

    it("should allow authenticated label listing", async () => {
      const result = await suite.cli("label", "list");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("whoami", () => {
    it("should return the current user profile", async () => {
      const result = await suite.cli("auth", "whoami");
      expect(result.exitCode).toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toContain("testuser");
      expect(output).toContain("Test User");
    });

    it("should fail without auth token", async () => {
      const result = await suite.unauthenticatedCli("auth", "whoami");
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("login stdin", () => {
    it("should read PAT from stdin when --pat - is used", async () => {
      const result = await suite.cliWithStdin("fake-token-via-stdin", "auth", "login", "--pat", "-");
      // The token reaches the server (auth fails because it's not a real GitHub PAT,
      // but the important thing is that it was read from stdin, not treated as literal "-")
      const output = result.stdout + result.stderr;
      expect(output).not.toContain("no token received from stdin");
      expect(result.exitCode).not.toBe(0); // expected: fake token fails GitHub validation
    });

    it("should fail with empty stdin when --pat - is used", async () => {
      const result = await suite.cliWithStdin("", "auth", "login", "--pat", "-");
      const output = result.stdout + result.stderr;
      expect(output).toContain("no token received from stdin");
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("login --pat direct (deprecated)", () => {
    it("should print deprecation warning when a literal token is passed", async () => {
      const result = await suite.cli("auth", "login", "--pat", "ghp_fake_token");
      const output = result.stdout + result.stderr;
      expect(output).toContain("deprecated");
      expect(output).toContain("--pat -");
      expect(result.exitCode).not.toBe(0); // fake token fails auth, but warning was printed
    });

    it("should not print deprecation warning when --pat - is used", async () => {
      const result = await suite.cliWithStdin("fake-token", "auth", "login", "--pat", "-");
      const output = result.stdout + result.stderr;
      expect(output).not.toContain("deprecated");
    });
  });

  describe("login --code stdin", () => {
    it("should read OAuth code from stdin when --code - is used", async () => {
      const result = await suite.cliWithStdin("fake-oauth-code", "auth", "login", "--code", "-");
      // The code reaches the server (auth fails because it's not a real OAuth code,
      // but the important thing is that it was read from stdin, not treated as literal "-")
      const output = result.stdout + result.stderr;
      expect(output).not.toContain("no code received from stdin");
      expect(result.exitCode).not.toBe(0); // expected: fake code fails OAuth validation
    });

    it("should fail with empty stdin when --code - is used", async () => {
      const result = await suite.cliWithStdin("", "auth", "login", "--code", "-");
      const output = result.stdout + result.stderr;
      expect(output).toContain("no code received from stdin");
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("logout", () => {
    it("should succeed even without stored token", async () => {
      const result = await suite.cli("auth", "logout");
      expect(result.exitCode).toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toContain("Logged out");
    });
  });
});
