// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema, AgentProfileSchema } from "../gen/hub/v1/hub_pb";
import type { Agent } from "../types";

vi.mock("../api/agentHubClient", () => ({
  createSession: vi.fn(),
}));

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
});
