import { describe, it, expect } from "vitest";
import { validateSessionId, validateAgentProfile } from "./validateSession";

describe("validateSessionId", () => {
  describe("valid inputs", () => {
    it("accepts a real CUID", () => {
      expect(validateSessionId("cmnae8t2h0027qv01erwytyz0")).toBe(true);
    });

    it("accepts a short alphanumeric with hyphen", () => {
      expect(validateSessionId("sess-1")).toBe(true);
    });

    it("accepts uppercase letters", () => {
      expect(validateSessionId("SESS-ABC")).toBe(true);
    });

    it("accepts underscores", () => {
      expect(validateSessionId("session_123")).toBe(true);
    });

    it("accepts exactly 128 characters", () => {
      const id = "a".repeat(128);
      expect(validateSessionId(id)).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it("rejects empty string", () => {
      expect(validateSessionId("")).toBe(false);
    });

    it("rejects string containing spaces", () => {
      expect(validateSessionId("sess abc")).toBe(false);
    });

    it("rejects string containing a slash", () => {
      expect(validateSessionId("foo/bar")).toBe(false);
    });

    it("rejects shell injection with $(...)", () => {
      expect(validateSessionId("$(rm -rf .)")).toBe(false);
    });

    it("rejects string of 129 characters", () => {
      const id = "a".repeat(129);
      expect(validateSessionId(id)).toBe(false);
    });
  });
});

describe("validateAgentProfile", () => {
  describe("valid inputs", () => {
    it("accepts 'default'", () => {
      expect(validateAgentProfile("default")).toBe(true);
    });

    it("accepts hyphenated profile name", () => {
      expect(validateAgentProfile("my-profile")).toBe(true);
    });

    it("accepts profile with dot", () => {
      expect(validateAgentProfile("profile.v2")).toBe(true);
    });

    it("accepts profile with colon", () => {
      expect(validateAgentProfile("agent:local")).toBe(true);
    });

    it("accepts profile with underscore and digits", () => {
      expect(validateAgentProfile("Profile_123")).toBe(true);
    });

    it("accepts exactly 64 characters", () => {
      const profile = "a".repeat(64);
      expect(validateAgentProfile(profile)).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it("rejects empty string", () => {
      expect(validateAgentProfile("")).toBe(false);
    });

    it("rejects string containing spaces", () => {
      expect(validateAgentProfile("my profile")).toBe(false);
    });

    it("rejects string containing $", () => {
      expect(validateAgentProfile("$evil")).toBe(false);
    });

    it("rejects string containing a slash", () => {
      expect(validateAgentProfile("some/profile")).toBe(false);
    });

    it("rejects string of 65 characters", () => {
      const profile = "a".repeat(65);
      expect(validateAgentProfile(profile)).toBe(false);
    });
  });
});
