import { describe, it, expect } from "vitest";
import { normalizeSessionName, parseSessionName, sessionMatchesTicket, stripProjectPrefix } from "./sessionName";

describe("normalizeSessionName", () => {
  describe("basic normalization", () => {
    it("lowercases the input", () => {
      expect(normalizeSessionName("Hello")).toBe("hello");
    });

    it("trims leading and trailing whitespace", () => {
      expect(normalizeSessionName("  hello  ")).toBe("hello");
    });

    it("preserves valid lowercase alphanumeric input unchanged", () => {
      expect(normalizeSessionName("hello123")).toBe("hello123");
    });

    it("preserves underscores in the middle", () => {
      expect(normalizeSessionName("hello_world")).toBe("hello_world");
    });

    it("preserves hyphens in the middle", () => {
      expect(normalizeSessionName("hello-world")).toBe("hello-world");
    });
  });

  describe("character replacement", () => {
    it("replaces spaces with hyphens", () => {
      expect(normalizeSessionName("hello world")).toBe("hello-world");
    });

    it("replaces dots with hyphens", () => {
      expect(normalizeSessionName("my.session")).toBe("my-session");
    });

    it("replaces slashes with hyphens", () => {
      expect(normalizeSessionName("my/session")).toBe("my-session");
    });

    it("replaces special characters with hyphens", () => {
      expect(normalizeSessionName("hello!world")).toBe("hello-world");
    });
  });

  describe("consecutive hyphen collapsing", () => {
    it("collapses consecutive hyphens into one", () => {
      expect(normalizeSessionName("hello--world")).toBe("hello-world");
    });

    it("collapses multiple spaces into a single hyphen", () => {
      expect(normalizeSessionName("hello   world")).toBe("hello-world");
    });

    it("collapses mixed special characters into a single hyphen", () => {
      expect(normalizeSessionName("hello!@#world")).toBe("hello-world");
    });
  });

  describe("leading non-alphanumeric stripping", () => {
    it("strips a leading hyphen", () => {
      expect(normalizeSessionName("-hello")).toBe("hello");
    });

    it("strips a leading underscore", () => {
      expect(normalizeSessionName("_hello")).toBe("hello");
    });

    it("strips multiple leading hyphens", () => {
      expect(normalizeSessionName("---hello")).toBe("hello");
    });

    it("preserves a leading digit", () => {
      expect(normalizeSessionName("123hello")).toBe("123hello");
    });
  });

  describe("trailing hyphen and underscore stripping", () => {
    it("strips a trailing hyphen", () => {
      expect(normalizeSessionName("hello-")).toBe("hello");
    });

    it("strips a trailing underscore", () => {
      expect(normalizeSessionName("hello_")).toBe("hello");
    });

    it("strips multiple trailing underscores", () => {
      expect(normalizeSessionName("hello__")).toBe("hello");
    });

    it("strips mixed trailing hyphen and underscore", () => {
      expect(normalizeSessionName("hello-_")).toBe("hello");
    });
  });

  describe("empty and degenerate inputs", () => {
    it("returns empty string for empty input", () => {
      expect(normalizeSessionName("")).toBe("");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(normalizeSessionName("   ")).toBe("");
    });

    it("returns empty string when all characters are invalid", () => {
      expect(normalizeSessionName("!!!")).toBe("");
    });

    it("returns empty string for all-hyphen input", () => {
      expect(normalizeSessionName("---")).toBe("");
    });

    it("returns empty string for all-underscore input", () => {
      expect(normalizeSessionName("___")).toBe("");
    });
  });
});

describe("stripProjectPrefix", () => {
  it("strips a 25-char CUID prefix followed by a hyphen", () => {
    const name = "abcdefghijklmnopqrstuvwxy-session";
    expect(stripProjectPrefix(name)).toBe("session");
  });

  it("returns the name unchanged when it is too short to have a prefix", () => {
    expect(stripProjectPrefix("short-name")).toBe("short-name");
  });

  it("returns the name unchanged when length is exactly 26", () => {
    // length 26: not > 26, so no stripping
    const name = "abcdefghijklmnopqrstuvwxy-";
    expect(stripProjectPrefix(name)).toBe("abcdefghijklmnopqrstuvwxy-");
  });

  it("returns the name unchanged when character at index 25 is not a hyphen", () => {
    const name = "abcdefghijklmnopqrstuvwxyzsession";
    expect(stripProjectPrefix(name)).toBe("abcdefghijklmnopqrstuvwxyzsession");
  });
});

const CUID = "cmmryin270000ny01dc2msx3t";

describe("parseSessionName", () => {
  it("parses a prefixed lead session", () => {
    expect(parseSessionName(`${CUID}-lead-42`)).toEqual({ projectId: CUID, kind: "lead", ticketNumber: 42 });
  });

  it("parses an unprefixed session", () => {
    expect(parseSessionName("lead-680")).toEqual({ kind: "lead", ticketNumber: 680 });
  });

  it("parses refine and discuss kinds", () => {
    expect(parseSessionName("refine-7")).toEqual({ kind: "refine", ticketNumber: 7 });
    expect(parseSessionName(`${CUID}-discuss-7`)).toEqual({ projectId: CUID, kind: "discuss", ticketNumber: 7 });
  });

  it.each([
    "refine-all-1700000000",
    "resume-abcd1234-1700000000",
    "tester-9f8e7d6c-1234-5678-9abc-def012345678",
    "review-pr-42",
  ])("returns no ticket for non-ticket name %s", (name) => {
    const parsed = parseSessionName(name);
    expect(parsed.ticketNumber).toBeUndefined();
    expect(parsed.kind).toBeUndefined();
  });
});

describe("sessionMatchesTicket", () => {
  const repo = "https://github.com/org/repo";

  it("matches a prefixed name only for the same project", () => {
    const s = { name: `${CUID}-lead-5` };
    expect(sessionMatchesTicket(s, 5, CUID, repo)).toBe(true);
    expect(sessionMatchesTicket(s, 5, "cmother0000000000000000000", repo)).toBe(false);
  });

  it("rejects a different ticket number", () => {
    expect(sessionMatchesTicket({ name: "lead-5" }, 6)).toBe(false);
  });

  it("matches an unprefixed name when the session repo matches the project repo", () => {
    const s = { name: "lead-680", repoUrl: "git@github.com:Org/Repo.git" };
    expect(sessionMatchesTicket(s, 680, CUID, repo)).toBe(true);
  });

  it("rejects an unprefixed name on a different repo", () => {
    const s = { name: "lead-680", repoUrl: "https://github.com/org/other" };
    expect(sessionMatchesTicket(s, 680, CUID, repo)).toBe(false);
  });

  it("matches an unprefixed name when no project repo is known", () => {
    expect(sessionMatchesTicket({ name: "lead-680" }, 680, CUID)).toBe(true);
  });
});
