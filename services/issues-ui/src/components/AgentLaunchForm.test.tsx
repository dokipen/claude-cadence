// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema, AgentProfileSchema } from "../gen/hub/v1/hub_pb";
import type { Agent, AgentStatus, Session } from "../types";

vi.mock("../api/agentHubClient", () => ({
  createSession: vi.fn(),
}));

import { createSession } from "../api/agentHubClient";

vi.mock("../styles/agents.module.css", () => ({
  default: {
    launchForm: "launch-form",
    launchFormFields: "launch-form-fields",
    profileSelect: "profile-select",
    profileLabel: "profile-label",
    select: "select",
    nameInput: "name-input",
    launcherError: "launcher-error",
    launchButton: "launch-button",
  },
}));

import { AgentLaunchForm } from "./AgentLaunchForm";

const makeAgent = (
  name: string,
  status: AgentStatus,
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
  }) as unknown as Agent;

const makeAgentWithNamedProfiles = (
  agentName: string,
  status: AgentStatus,
  profiles: Record<string, { repo: string; name?: string }>,
): Agent =>
  create(AgentSchema, {
    name: agentName,
    status,
    lastSeen: "2024-01-01T00:00:00Z",
    profiles: Object.fromEntries(
      Object.entries(profiles).map(([profileKey, { repo, name }]) => [
        profileKey,
        create(AgentProfileSchema, { repo, ...(name !== undefined ? { name } : {}) }),
      ]),
    ),
  }) as unknown as Agent;

afterEach(() => cleanup());

describe("AgentLaunchForm", () => {
  it("resets selected host and profile when repoUrl changes", async () => {
    const agents = [
      makeAgent("host-a", "online", {
        "profile-a": "https://github.com/org/repo-a",
      }),
      makeAgent("host-b", "online", {
        "profile-b": "https://github.com/org/repo-b",
      }),
    ];

    const onLaunched = vi.fn();
    const { getByTestId, rerender } = render(
      <AgentLaunchForm
        agents={agents}
        onLaunched={onLaunched}
        repoUrl="https://github.com/org/repo-a"
      />,
    );

    // Select host-a
    await act(async () => {
      fireEvent.change(getByTestId("host-select"), {
        target: { value: "host-a" },
      });
    });
    expect((getByTestId("host-select") as HTMLSelectElement).value).toBe(
      "host-a",
    );

    // Switch to repo-b — host and profile should reset
    await act(async () => {
      rerender(
        <AgentLaunchForm
          agents={agents}
          onLaunched={onLaunched}
          repoUrl="https://github.com/org/repo-b"
        />,
      );
    });

    expect((getByTestId("host-select") as HTMLSelectElement).value).toBe("");
    expect((getByTestId("profile-select") as HTMLSelectElement).value).toBe(
      "",
    );
  });

  it("shows profiles from pre-filtered agents (filtering is server-side)", async () => {
    // The agents prop is already filtered server-side: only profile-match is present.
    const agents = [
      makeAgent("host-a", "online", {
        "profile-match": "https://github.com/org/repo-a",
      }),
    ];

    const { getByTestId, queryByRole } = render(
      <AgentLaunchForm
        agents={agents}
        onLaunched={vi.fn()}
        repoUrl="https://github.com/org/repo-a"
      />,
    );

    await act(async () => {
      fireEvent.change(getByTestId("host-select"), {
        target: { value: "host-a" },
      });
    });

    const profileSelect = getByTestId("profile-select");
    const options = Array.from(profileSelect.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toContain("profile-match");
    expect(options).not.toContain("profile-other");
    void queryByRole; // suppress unused warning
  });

  it("shows all profiles when no repoUrl is provided", async () => {
    const agents = [
      makeAgent("host-a", "online", {
        "profile-x": "https://github.com/org/repo-a",
        "profile-y": "https://github.com/org/repo-b",
      }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm agents={agents} onLaunched={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.change(getByTestId("host-select"), {
        target: { value: "host-a" },
      });
    });

    const profileSelect = getByTestId("profile-select");
    const options = Array.from(profileSelect.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toContain("profile-x");
    expect(options).toContain("profile-y");
  });

  it("shows profiles from the online agent, not the offline agent with the same name", async () => {
    // The offline agent appears FIRST in the array and has "offline-profile".
    // The online agent appears SECOND and has "online-profile".
    // With the bug (agents.find instead of onlineAgents.find), the offline
    // agent's profiles are returned because it is earlier in the array.
    const agents = [
      makeAgent("agent-1", "offline", { "offline-profile": "https://github.com/org/repo" }),
      makeAgent("agent-1", "online",  { "online-profile":  "https://github.com/org/repo" }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm agents={agents} onLaunched={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.change(getByTestId("host-select"), {
        target: { value: "agent-1" },
      });
    });

    const profileSelect = getByTestId("profile-select");
    const options = Array.from(profileSelect.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toContain("online-profile");
    expect(options).not.toContain("offline-profile");
  });

  it("name input has autocomplete=off", () => {
    const agents = [
      makeAgent("host-a", "online", {
        "profile-a": "https://github.com/org/repo-a",
      }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm
        agents={agents}
        onLaunched={vi.fn()}
        repoUrl="https://github.com/org/repo-a"
      />,
    );

    const nameInput = getByTestId("name-input");
    expect(nameInput).toHaveAttribute("autocomplete", "off");
  });

  it("host-select has autocomplete=off", () => {
    const agents = [
      makeAgent("host-a", "online", {
        "profile-a": "https://github.com/org/repo-a",
      }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm
        agents={agents}
        onLaunched={vi.fn()}
        repoUrl="https://github.com/org/repo-a"
      />,
    );

    const hostSelect = getByTestId("host-select");
    expect(hostSelect).toHaveAttribute("autocomplete", "off");
  });

  it("profile-select has autocomplete=off", () => {
    const agents = [
      makeAgent("host-a", "online", {
        "profile-a": "https://github.com/org/repo-a",
      }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm
        agents={agents}
        onLaunched={vi.fn()}
        repoUrl="https://github.com/org/repo-a"
      />,
    );

    const profileSelect = getByTestId("profile-select");
    expect(profileSelect).toHaveAttribute("autocomplete", "off");
  });

  it("displays profile name as option text when profile has a name field", async () => {
    const agents = [
      makeAgentWithNamedProfiles("host-a", "online", {
        "my-profile-key": { repo: "", name: "My Display Name" },
      }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm agents={agents} onLaunched={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.change(getByTestId("host-select"), {
        target: { value: "host-a" },
      });
    });

    const profileSelect = getByTestId("profile-select");
    const option = Array.from(profileSelect.querySelectorAll("option")).find(
      (o) => o.value === "my-profile-key",
    );
    expect(option).toBeTruthy();
    expect(option!.textContent).toBe("My Display Name");
  });

  it("falls back to map key as option text when profile has no name field", async () => {
    const agents = [
      makeAgentWithNamedProfiles("host-a", "online", {
        "my-profile-key": { repo: "" },
      }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm agents={agents} onLaunched={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.change(getByTestId("host-select"), {
        target: { value: "host-a" },
      });
    });

    const profileSelect = getByTestId("profile-select");
    const option = Array.from(profileSelect.querySelectorAll("option")).find(
      (o) => o.value === "my-profile-key",
    );
    expect(option).toBeTruthy();
    expect(option!.textContent).toBe("my-profile-key");
  });
});

describe("AgentLaunchForm profile filtering by repoUrl", () => {
  it("excludes a non-matching repo-scoped profile when repoUrl is provided", async () => {
    // host-a has one generic profile and one profile scoped to a different repo.
    // When repoUrl is org/repo-a, the non-matching repo-scoped profile must NOT appear.
    const agents = [
      makeAgent("host-a", "online", {
        "generic-profile": "",
        "other-repo-profile": "https://github.com/org/repo-b",
      }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm
        agents={agents}
        onLaunched={vi.fn()}
        repoUrl="https://github.com/org/repo-a"
      />,
    );

    await act(async () => {
      fireEvent.change(getByTestId("host-select"), {
        target: { value: "host-a" },
      });
    });

    const profileSelect = getByTestId("profile-select");
    const options = Array.from(profileSelect.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toContain("generic-profile");
    expect(options).not.toContain("other-repo-profile");
  });

  it("includes a generic (empty-repo) profile when repoUrl is provided", async () => {
    const agents = [
      makeAgent("host-a", "online", {
        "generic-profile": "",
      }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm
        agents={agents}
        onLaunched={vi.fn()}
        repoUrl="https://github.com/org/repo-a"
      />,
    );

    await act(async () => {
      fireEvent.change(getByTestId("host-select"), {
        target: { value: "host-a" },
      });
    });

    const profileSelect = getByTestId("profile-select");
    const options = Array.from(profileSelect.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toContain("generic-profile");
  });

  it("includes a matching repo-scoped profile when repoUrl is provided", async () => {
    const agents = [
      makeAgent("host-a", "online", {
        "matching-profile": "https://github.com/org/repo-a",
        "unrelated-profile": "https://github.com/org/repo-z",
      }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm
        agents={agents}
        onLaunched={vi.fn()}
        repoUrl="https://github.com/org/repo-a"
      />,
    );

    await act(async () => {
      fireEvent.change(getByTestId("host-select"), {
        target: { value: "host-a" },
      });
    });

    const profileSelect = getByTestId("profile-select");
    const options = Array.from(profileSelect.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toContain("matching-profile");
    expect(options).not.toContain("unrelated-profile");
  });

  it("shows only generic profiles when agent has a mix and repoUrl does not match any repo-scoped profile", async () => {
    // host-a has two repo-scoped profiles (neither matches) and one generic profile.
    const agents = [
      makeAgent("host-a", "online", {
        "generic-profile": "",
        "repo-b-profile": "https://github.com/org/repo-b",
        "repo-c-profile": "https://github.com/org/repo-c",
      }),
    ];

    const { getByTestId } = render(
      <AgentLaunchForm
        agents={agents}
        onLaunched={vi.fn()}
        repoUrl="https://github.com/org/repo-a"
      />,
    );

    await act(async () => {
      fireEvent.change(getByTestId("host-select"), {
        target: { value: "host-a" },
      });
    });

    const profileSelect = getByTestId("profile-select");
    const options = Array.from(profileSelect.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toContain("generic-profile");
    expect(options).not.toContain("repo-b-profile");
    expect(options).not.toContain("repo-c-profile");
  });
});

describe("AgentLaunchForm session name normalization", () => {
  const makeSimpleAgent = (): Agent =>
    makeAgent("host-a", "online", { "profile-a": "" });

  const fakeSession = { id: "sess-1", name: "sess-1" } as unknown as Session;

  async function fillAndSubmit(
    getByTestId: (id: string) => HTMLElement,
    nameValue: string,
  ) {
    await act(async () => {
      fireEvent.change(getByTestId("host-select"), { target: { value: "host-a" } });
    });
    await act(async () => {
      fireEvent.change(getByTestId("profile-select"), { target: { value: "profile-a" } });
    });
    await act(async () => {
      fireEvent.change(getByTestId("name-input"), { target: { value: nameValue } });
    });
    await act(async () => {
      fireEvent.submit(getByTestId("agent-launch-form"));
    });
  }

  afterEach(() => {
    cleanup();
    vi.mocked(createSession).mockReset();
  });

  it("trims and lowercases mixed-case input before calling createSession", async () => {
    vi.mocked(createSession).mockResolvedValue(fakeSession);
    const { getByTestId } = render(
      <AgentLaunchForm agents={[makeSimpleAgent()]} onLaunched={vi.fn()} />,
    );
    await fillAndSubmit(getByTestId, "  My Session  ");
    expect(vi.mocked(createSession)).toHaveBeenCalledWith("host-a", "profile-a", "my-session");
  });

  it("replaces spaces with hyphens", async () => {
    vi.mocked(createSession).mockResolvedValue(fakeSession);
    const { getByTestId } = render(
      <AgentLaunchForm agents={[makeSimpleAgent()]} onLaunched={vi.fn()} />,
    );
    await fillAndSubmit(getByTestId, "fix the bug");
    expect(vi.mocked(createSession)).toHaveBeenCalledWith("host-a", "profile-a", "fix-the-bug");
  });

  it("collapses consecutive spaces and hyphens into a single hyphen", async () => {
    vi.mocked(createSession).mockResolvedValue(fakeSession);
    const { getByTestId } = render(
      <AgentLaunchForm agents={[makeSimpleAgent()]} onLaunched={vi.fn()} />,
    );
    await fillAndSubmit(getByTestId, "fix  the--bug");
    expect(vi.mocked(createSession)).toHaveBeenCalledWith("host-a", "profile-a", "fix-the-bug");
  });

  it("passes through an already-valid slug unchanged", async () => {
    vi.mocked(createSession).mockResolvedValue(fakeSession);
    const { getByTestId } = render(
      <AgentLaunchForm agents={[makeSimpleAgent()]} onLaunched={vi.fn()} />,
    );
    await fillAndSubmit(getByTestId, "lead-42");
    expect(vi.mocked(createSession)).toHaveBeenCalledWith("host-a", "profile-a", "lead-42");
  });

  it("preserves underscores", async () => {
    vi.mocked(createSession).mockResolvedValue(fakeSession);
    const { getByTestId } = render(
      <AgentLaunchForm agents={[makeSimpleAgent()]} onLaunched={vi.fn()} />,
    );
    await fillAndSubmit(getByTestId, "my_session");
    expect(vi.mocked(createSession)).toHaveBeenCalledWith("host-a", "profile-a", "my_session");
  });

  it("shows a specific error and does not call createSession when name is whitespace-only", async () => {
    const { getByTestId, getByText } = render(
      <AgentLaunchForm agents={[makeSimpleAgent()]} onLaunched={vi.fn()} />,
    );
    await fillAndSubmit(getByTestId, "   ");
    expect(getByText("Session name cannot be empty.")).toBeTruthy();
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
  });

  it("shows a specific error and does not call createSession when name normalizes to empty", async () => {
    const { getByTestId, getByText } = render(
      <AgentLaunchForm agents={[makeSimpleAgent()]} onLaunched={vi.fn()} />,
    );
    await fillAndSubmit(getByTestId, "---");
    expect(getByText("Session name cannot be empty.")).toBeTruthy();
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
  });
});
