import { describe, it, expect, vi, beforeEach } from "vitest";

describe("parseAllowedUsers", () => {
  let parseAllowedUsers: typeof import("./allowlist.js").parseAllowedUsers;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./allowlist.js");
    parseAllowedUsers = mod.parseAllowedUsers;
  });

  it("returns null for undefined", () => {
    expect(parseAllowedUsers(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAllowedUsers("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseAllowedUsers("   ")).toBeNull();
  });

  it("parses a single user", () => {
    const result = parseAllowedUsers("alice");
    expect(result).toEqual(new Set(["alice"]));
  });

  it("parses comma-separated users", () => {
    const result = parseAllowedUsers("alice,bob,charlie");
    expect(result).toEqual(new Set(["alice", "bob", "charlie"]));
  });

  it("trims whitespace around usernames", () => {
    const result = parseAllowedUsers("  alice , bob , charlie  ");
    expect(result).toEqual(new Set(["alice", "bob", "charlie"]));
  });

  it("lowercases usernames", () => {
    const result = parseAllowedUsers("Alice,BOB,Charlie");
    expect(result).toEqual(new Set(["alice", "bob", "charlie"]));
  });

  it("ignores empty entries from trailing commas", () => {
    const result = parseAllowedUsers("alice,,bob,");
    expect(result).toEqual(new Set(["alice", "bob"]));
  });

  it("returns null when all entries are empty after filtering", () => {
    expect(parseAllowedUsers(",")).toBeNull();
    expect(parseAllowedUsers(",,")).toBeNull();
  });
});

describe("enforceAllowlist", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadWithEnv(
    value: string | undefined
  ): Promise<typeof import("./allowlist.js").enforceAllowlist> {
    if (value === undefined) {
      delete process.env.ALLOWED_USERS;
    } else {
      process.env.ALLOWED_USERS = value;
    }
    const mod = await import("./allowlist.js");
    return mod.enforceAllowlist;
  }

  it("allows any user when ALLOWED_USERS is unset", async () => {
    const enforceAllowlist = await loadWithEnv(undefined);
    expect(() => enforceAllowlist("anyone")).not.toThrow();
  });

  it("allows any user when ALLOWED_USERS is empty", async () => {
    const enforceAllowlist = await loadWithEnv("");
    expect(() => enforceAllowlist("anyone")).not.toThrow();
  });

  it("allows a user on the list", async () => {
    const enforceAllowlist = await loadWithEnv("alice,bob");
    expect(() => enforceAllowlist("alice")).not.toThrow();
  });

  it("rejects a user not on the list", async () => {
    const enforceAllowlist = await loadWithEnv("alice,bob");
    expect(() => enforceAllowlist("charlie")).toThrow(
      "User is not authorized to access this application"
    );
  });

  it("rejects with FORBIDDEN code", async () => {
    const enforceAllowlist = await loadWithEnv("alice");
    try {
      enforceAllowlist("bob");
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.extensions?.code).toBe("FORBIDDEN");
    }
  });

  it("is case-insensitive", async () => {
    const enforceAllowlist = await loadWithEnv("Alice");
    expect(() => enforceAllowlist("ALICE")).not.toThrow();
    expect(() => enforceAllowlist("alice")).not.toThrow();
  });
});
