// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
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
import type { AgentLauncherHandle } from "./AgentLauncher";
import { createSession } from "../api/agentHubClient";

const mockUseAgents = vi.mocked(useAgents);
const mockUseAgentProfiles = vi.mocked(useAgentProfiles);

const makeProfileEntry = (
  agent: string,
  profileName: string,
  repo: string,
  displayName?: string,
): AgentProfileEntry => ({
  agent,
  profileName,
  profile: { repo, name: displayName } as AgentProfileEntry["profile"],
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

  it("shows profile.name instead of profileName when profile.name is set (single profile)", () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "default", "https://github.com/org/repo-a", "My Display Name"),
    ]);

    const { getByTestId } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={vi.fn()}
      />,
    );

    const profileSingle = getByTestId("profile-single");
    expect(profileSingle.textContent).toContain("My Display Name");
    expect(profileSingle.textContent).not.toContain("default");
  });

  it("shows profile.name in dropdown options when profile.name is set (multi profile)", () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "default", "https://github.com/org/repo-a", "Fast Worker"),
      makeProfileEntry("host-a", "slow", "", "Slow Worker"),
    ]);

    const { getByTestId } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={vi.fn()}
      />,
    );

    const profileSelect = getByTestId("profile-select");
    const optionTexts = Array.from(profileSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(optionTexts.some((t) => t?.includes("Fast Worker"))).toBe(true);
    expect(optionTexts.some((t) => t?.includes("Slow Worker"))).toBe(true);
    expect(optionTexts.some((t) => t?.includes("default"))).toBe(false);
    expect(optionTexts.some((t) => t?.includes("slow"))).toBe(false);
  });

  it("falls back to profileName when profile.name is absent", () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "fallback-key", "https://github.com/org/repo-a"),
    ]);

    const { getByTestId } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={vi.fn()}
      />,
    );

    const profileSingle = getByTestId("profile-single");
    expect(profileSingle.textContent).toContain("fallback-key");
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

describe("AgentLauncher selection stability (issue #568)", () => {
  it("preserves user selection when profiles reference changes but content is the same (polling)", async () => {
    const profiles1 = [
      makeProfileEntry("host-a", "profile-a", "https://github.com/org/repo-a"),
      makeProfileEntry("host-a", "profile-b", ""),
    ];
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    mockUseAgentProfiles.mockReturnValue(profiles1);

    vi.mocked(createSession).mockResolvedValue({ id: "s1" } as never);
    const onLaunched = vi.fn();
    const { getByTestId, rerender } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={onLaunched}
      />,
    );

    // User selects the second profile
    fireEvent.change(getByTestId("profile-select"), { target: { value: "host-a/profile-b" } });

    // Simulate a polling update: new array reference, identical content
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "profile-a", "https://github.com/org/repo-a"),
      makeProfileEntry("host-a", "profile-b", ""),
    ]);
    rerender(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={onLaunched}
      />,
    );

    // Selection must survive the polling update
    expect((getByTestId("profile-select") as HTMLSelectElement).value).toBe("host-a/profile-b");

    // Launching must use the user-selected profile, not the default
    await act(async () => {
      fireEvent.click(getByTestId("launch-submit"));
    });
    expect(vi.mocked(createSession)).toHaveBeenCalledWith(
      "host-a",
      "profile-b",
      expect.any(String),
      expect.any(Array),
    );
  });

  it("resets to first profile when the selected profile goes offline", async () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "profile-a", "https://github.com/org/repo-a"),
      makeProfileEntry("host-a", "profile-b", ""),
    ]);

    vi.mocked(createSession).mockResolvedValue({ id: "s1" } as never);
    const onLaunched = vi.fn();
    const { getByTestId, rerender } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={onLaunched}
      />,
    );

    // User selects profile-b
    fireEvent.change(getByTestId("profile-select"), { target: { value: "host-a/profile-b" } });

    // profile-b goes offline — only profile-a remains
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "profile-a", "https://github.com/org/repo-a"),
    ]);
    rerender(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={onLaunched}
      />,
    );

    // Single profile now — shows profile-single display, launch uses profile-a
    await act(async () => {
      fireEvent.click(getByTestId("launch-submit"));
    });
    expect(vi.mocked(createSession)).toHaveBeenCalledWith(
      "host-a",
      "profile-a",
      expect.any(String),
      expect.any(Array),
    );
  });

  it("preserves user selection when a new profile is added (profiles array grows)", async () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "profile-a", "https://github.com/org/repo-a"),
      makeProfileEntry("host-a", "profile-b", ""),
    ]);

    vi.mocked(createSession).mockResolvedValue({ id: "s1" } as never);
    const onLaunched = vi.fn();
    const { getByTestId, rerender } = render(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={onLaunched}
      />,
    );

    // User selects profile-b
    fireEvent.change(getByTestId("profile-select"), { target: { value: "host-a/profile-b" } });

    // A new agent comes online — profiles array grows
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "profile-a", "https://github.com/org/repo-a"),
      makeProfileEntry("host-a", "profile-b", ""),
      makeProfileEntry("host-b", "profile-c", ""),
    ]);
    rerender(
      <AgentLauncher
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={onLaunched}
      />,
    );

    // profile-b selection must be preserved
    expect((getByTestId("profile-select") as HTMLSelectElement).value).toBe("host-a/profile-b");
  });
});

describe("AgentLauncher handleLaunch concurrency guard", () => {
  it("rapid double-launch only fires createSession once", async () => {
    // createSession never resolves — keeps the first launch in-flight when the
    // second fires, reproducing the race where both reads see launching===false
    vi.mocked(createSession).mockImplementation(
      () => new Promise(() => {}),
    );

    mockUseAgents.mockReturnValue({ agents: [], loading: false, error: null });
    mockUseAgentProfiles.mockReturnValue([
      makeProfileEntry("host-a", "profile-match", "https://github.com/org/repo-a"),
    ]);

    const ref = React.createRef<AgentLauncherHandle>();

    render(
      <AgentLauncher
        ref={ref}
        ticketNumber={1}
        repoUrl="https://github.com/org/repo-a"
        onLaunched={vi.fn()}
      />,
    );

    // Call launch twice without awaiting — both calls read launching===false
    // before any re-render occurs, so both proceed to call createSession.
    ref.current!.launch();
    ref.current!.launch();

    // Without a concurrency guard, createSession is called twice.
    // The fix should ensure it is called only once.
    expect(vi.mocked(createSession)).toHaveBeenCalledTimes(1);
  });
});
