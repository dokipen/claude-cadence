// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema, AgentProfileSchema } from "../gen/hub/v1/hub_pb";
import { normalizeRepo, useAgentProfiles } from "./useAgents";
import type { Agent } from "../types";

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
    expect(normalizeRepo("https://gitlab.com/owner/repo.git")).toBe(
      "https://gitlab.com/owner/repo",
    );
  });

  it("passes through non-GitHub SSH remotes unchanged (minus .git)", () => {
    expect(normalizeRepo("git@gitlab.com:owner/repo.git")).toBe(
      "git@gitlab.com:owner/repo",
    );
  });
});

describe("normalizeRepo - nullish inputs from recovered sessions", () => {
  it("returns empty string for undefined (recovered session with no repo_url)", () => {
    expect(normalizeRepo(undefined)).toBe("");
  });

  it("returns empty string for null (defensive: guard handles falsy values beyond undefined)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeRepo(null as any)).toBe("");
  });
});

const makeAgent = (
  name: string,
  status: string,
  profiles: Record<string, string>,
): Agent =>
  create(AgentSchema, {
    name,
    status,
    lastSeen: "2024-01-01T00:00:00Z",
    profiles: Object.fromEntries(
      Object.entries(profiles).map(([profileName, repo]) => [
        profileName,
        create(AgentProfileSchema, { repo }),
      ]),
    ),
  });

describe("useAgentProfiles", () => {
  it("returns empty array when repoUrl is undefined", () => {
    const agents = [makeAgent("agent1", "online", { default: "https://github.com/owner/repo" })];
    const { result } = renderHook(() => useAgentProfiles(undefined, agents));
    expect(result.current).toEqual([]);
  });

  it("returns only profiles matching the given repoUrl", () => {
    const agents = [
      makeAgent("agent1", "online", {
        "match-profile": "https://github.com/owner/repo",
        "other-profile": "https://github.com/other/project",
      }),
    ];
    const { result } = renderHook(() =>
      useAgentProfiles("https://github.com/owner/repo", agents),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ agent: "agent1", profileName: "match-profile" });
  });

  it("skips offline agents", () => {
    const agents = [
      makeAgent("offline-agent", "offline", { default: "https://github.com/owner/repo" }),
      makeAgent("online-agent", "online", { default: "https://github.com/owner/repo" }),
    ];
    const { result } = renderHook(() =>
      useAgentProfiles("https://github.com/owner/repo", agents),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].agent).toBe("online-agent");
  });

  it("returns profiles from multiple agents when they match", () => {
    const agents = [
      makeAgent("agent1", "online", { "profile-a": "https://github.com/owner/repo" }),
      makeAgent("agent2", "online", { "profile-b": "https://github.com/owner/repo" }),
    ];
    const { result } = renderHook(() =>
      useAgentProfiles("https://github.com/owner/repo", agents),
    );
    expect(result.current).toHaveLength(2);
    expect(result.current.map((e) => e.agent)).toEqual(["agent1", "agent2"]);
  });

  it("returns empty array when no profiles match the repoUrl", () => {
    const agents = [makeAgent("agent1", "online", { default: "https://github.com/other/repo" })];
    const { result } = renderHook(() =>
      useAgentProfiles("https://github.com/owner/repo", agents),
    );
    expect(result.current).toEqual([]);
  });

  it("includes generic profiles with empty repo when repoUrl is set", () => {
    const agents = [
      makeAgent("agent1", "online", {
        "generic": "",
        "other-project": "https://github.com/other/project",
      }),
    ];
    const { result } = renderHook(() =>
      useAgentProfiles("https://github.com/owner/repo", agents),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].profileName).toBe("generic");
  });

  it("normalizes repoUrl formats when matching (SSH vs HTTPS)", () => {
    const agents = [
      makeAgent("agent1", "online", { default: "git@github.com:owner/repo.git" }),
    ];
    const { result } = renderHook(() =>
      useAgentProfiles("https://github.com/owner/repo", agents),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].profileName).toBe("default");
  });
});
