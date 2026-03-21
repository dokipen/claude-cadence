import { describe, it, expect } from "vitest";
import { normalizeRepo } from "./useAgents";

describe("normalizeRepo", () => {
  it("strips https://github.com/ prefix", () => {
    expect(normalizeRepo("https://github.com/owner/repo")).toBe("owner/repo");
  });

  it("strips https://github.com/ prefix with .git suffix", () => {
    expect(normalizeRepo("https://github.com/owner/repo.git")).toBe(
      "owner/repo",
    );
  });

  it("strips http://github.com/ prefix", () => {
    expect(normalizeRepo("http://github.com/owner/repo")).toBe("owner/repo");
  });

  it("strips http://github.com/ prefix with .git suffix", () => {
    expect(normalizeRepo("http://github.com/owner/repo.git")).toBe(
      "owner/repo",
    );
  });

  it("strips git@github.com: prefix", () => {
    expect(normalizeRepo("git@github.com:owner/repo")).toBe("owner/repo");
  });

  it("strips git@github.com: prefix with .git suffix", () => {
    expect(normalizeRepo("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  it("passes through an already-normalized owner/repo slug", () => {
    expect(normalizeRepo("owner/repo")).toBe("owner/repo");
  });

  it("passes through non-GitHub hosts unchanged (minus .git)", () => {
    expect(normalizeRepo("https://gitlab.com/owner/repo")).toBe(
      "https://gitlab.com/owner/repo",
    );
  });

  it("passes through non-GitHub SSH remotes unchanged (minus .git)", () => {
    expect(normalizeRepo("git@gitlab.com:owner/repo.git")).toBe(
      "git@gitlab.com:owner/repo",
    );
  });
});
