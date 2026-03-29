import { describe, it, expect } from "vitest";
import { normalizeSessionName, stripProjectPrefix } from "./sessionName";

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
