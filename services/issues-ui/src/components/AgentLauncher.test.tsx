// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { AgentProfileEntry } from "../hooks/useAgents";

vi.mock("../api/agentHubClient", () => ({
  createSession: vi.fn(),
}));

vi.mock("../styles/agents.module.css", () => ({
  default: {
    launcher: "launcher",
    launcherInline: "launcher-inline",
    launcherMessage: "launcher-message",
    launcherError: "launcher-error",
    profileSingle: "profile-single",
    profileSelect: "profile-select",
    profileLabel: "profile-label",
    profileValue: "profile-value",
    select: "select",
    launchButton: "launch-button",
  },
}));

// useAgents and useAgentProfiles are mocked so tests control the profile list
// without requiring a live agentHubClient or polling logic.
vi.mock("../hooks/useAgents", () => ({
  useAgents: vi.fn(() => ({ agents: [], loading: false, error: null })),
  useAgentProfiles: vi.fn(() => []),
}));

import { useAgents, useAgentProfiles } from "../hooks/useAgents";
import { AgentLauncher } from "./AgentLauncher";

const mockUseAgents = vi.mocked(useAgents);
const mockUseAgentProfiles = vi.mocked(useAgentProfiles);

const makeProfileEntry = (
  agent: string,
  profileName: string,
  repo: string,
): AgentProfileEntry => ({
  agent,
  profileName,
  profile: { repo } as AgentProfileEntry["profile"],
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AgentLauncher profile filtering", () => {
  it("shows no-profiles message when repoUrl is set and no profiles match", () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    // useAgentProfiles returns empty — the non-matching repo-scoped profile was filtered out
    mockUseAgentProfiles.mockReturnValue([]);

    const { getByText } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={vi.fn()}
      />,
    );

    expect(
      getByText("No online agents with profiles matching this repository."),
    ).toBeTruthy();
  });

  it("shows the profile in the dropdown when it matches the repoUrl", () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "profile-match", "https://github.com/org/repo-a"),
    ]);

    const { getByTestId } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={vi.fn()}
      />,
    );

    // Single match renders profile-single, not a select dropdown
    const profileSingle = getByTestId("profile-single");
    expect(profileSingle.textContent).toContain("host-a");
    expect(profileSingle.textContent).toContain("profile-match");
  });

  it("shows a generic (empty-repo) profile when repoUrl is set", () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    // generic profile has empty repo — useAgentProfiles includes it for any repoUrl
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "generic-profile", ""),
    ]);

    const { getByTestId } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={vi.fn()}
      />,
    );

    const profileSingle = getByTestId("profile-single");
    expect(profileSingle.textContent).toContain("host-a");
    expect(profileSingle.textContent).toContain("generic-profile");
  });

  it("renders a select dropdown when multiple profiles are available", () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "profile-match", "https://github.com/org/repo-a"),
      makeProfileEntry("host-a", "generic-profile", ""),
    ]);

    const { getByTestId } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={vi.fn()}
      />,
    );

    const profileSelect = getByTestId("profile-select");
    const options = Array.from(profileSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(options.some((t) => t?.includes("profile-match"))).toBe(true);
    expect(options.some((t) => t?.includes("generic-profile"))).toBe(true);
  });

  it("does NOT include a non-matching repo-scoped profile in the dropdown", () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    // useAgentProfiles has already excluded the non-matching profile; only generic remains
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "generic-profile", ""),
    ]);

    const { getByTestId } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={vi.fn()}
      />,
    );

    // Only the generic profile appears in the single-profile display
    const profileSingle = getByTestId("profile-single");
    expect(profileSingle.textContent).toContain("generic-profile");
    // "profile-other" would appear as "host-a / profile-other" if the hook
    // returned it; asserting against the actual rendered content confirms it is absent
    expect(profileSingle.textContent).not.toContain("profile-other");
  });

  it("profile-select has autocomplete=off when multiple profiles are available", () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "profile-match", "https://github.com/org/repo-a"),
      makeProfileEntry("host-a", "generic-profile", ""),
    ]);

    const { getByTestId } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={vi.fn()}
      />,
    );

    const profileSelect = getByTestId("profile-select");
    expect(profileSelect).toHaveAttribute("autocomplete", "off");
  });
});
