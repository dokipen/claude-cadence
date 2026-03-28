// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "../gen/hub/v1/hub_pb";
import type { AgentSession } from "../hooks/useAllSessions";

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({
  default: {
    sidebarSessionOpen: "open",
    sidebarSession: "session",
  },
}));

// Mock useAgents hook
vi.mock("../hooks/useAgents", () => ({
  useAgents: vi.fn(() => ({
    agents: [
      {
        name: "test-agent",
        profiles: {},
        status: "online",
        lastSeen: "2024-01-01T00:00:00Z",
      },
    ],
    loading: false,
  })),
  normalizeRepo: (repo: string) => repo,
  useAgentProfiles: vi.fn(() => []),
}));

// Capture repoUrl prop from AgentLaunchForm for assertions
let capturedRepoUrl: string | undefined;
vi.mock("./AgentLaunchForm", () => ({
  AgentLaunchForm: ({ repoUrl }: { repoUrl?: string }) => {
    capturedRepoUrl = repoUrl;
    return <div data-testid="agent-launch-form" />;
  },
}));

// Capture onMinimize from TilingLayout so the test can invoke it
let capturedOnMinimize: ((key: string) => void) | undefined;
vi.mock("./TilingLayout", () => ({
  TilingLayout: ({ onMinimize }: { onMinimize: (key: string) => void }) => {
    capturedOnMinimize = onMinimize;
    return <div data-testid="tiling-layout" />;
  },
}));

import { MemoryRouter } from "react-router";
import { AgentManager } from "./AgentManager";

afterEach(() => {
  capturedOnMinimize = undefined;
  capturedRepoUrl = undefined;
  cleanup();
});

const makeSession = (id: string, agentName: string): AgentSession => ({
  agentName,
  session: create(SessionSchema, {
    id,
    name: `session-${id}`,
    agentProfile: "default",
    state: "running",
    createdAt: "2024-01-01T00:00:00Z",
    agentPid: 1234,
    repoUrl: "https://github.com/example/repo",
    baseRef: "main",
    waitingForInput: false,
  }),
});

describe("AgentManager", () => {
  it("minimized session button no longer has the open CSS class", async () => {
    const agentName = "test-agent";
    const sessionId = "sess-1";
    const sessions = [makeSession(sessionId, agentName)];

    const { getAllByTestId } = render(
      <MemoryRouter><AgentManager sessions={sessions} selectedProject={null} /></MemoryRouter>,
    );

    // Click the session button to open it
    const sessionButtons = getAllByTestId("sidebar-session");
    expect(sessionButtons).toHaveLength(1);
    const sessionBtn = sessionButtons[0];

    await act(async () => {
      fireEvent.click(sessionBtn);
    });

    // After clicking, the session should be open and have the 'open' class
    expect(sessionBtn.className).toContain("open");

    // Now trigger minimize via the captured callback
    const expectedKey = `${agentName}:${sessionId}`;
    await act(async () => {
      capturedOnMinimize!(expectedKey);
    });

    // After minimizing, the session should no longer be highlighted
    expect(sessionBtn.className).not.toContain("open");
  });

  it("restoring a minimized session re-applies the open CSS class", async () => {
    const agentName = "test-agent";
    const sessionId = "sess-1";
    const sessions = [makeSession(sessionId, agentName)];
    const expectedKey = `${agentName}:${sessionId}`;

    const { getAllByTestId } = render(
      <MemoryRouter><AgentManager sessions={sessions} selectedProject={null} /></MemoryRouter>,
    );

    const sessionButtons = getAllByTestId("sidebar-session");
    const sessionBtn = sessionButtons[0];

    // Open the session
    await act(async () => {
      fireEvent.click(sessionBtn);
    });
    expect(sessionBtn.className).toContain("open");

    // Minimize it
    await act(async () => {
      capturedOnMinimize!(expectedKey);
    });
    expect(sessionBtn.className).not.toContain("open");

    // Restore by clicking again
    await act(async () => {
      fireEvent.click(sessionBtn);
    });
    expect(sessionBtn.className).toContain("open");
  });

  it("passes selectedProject.repository as repoUrl to AgentLaunchForm", () => {
    render(
      <MemoryRouter>
        <AgentManager
          sessions={[]}
          selectedProject={{ id: "p1", name: "my-project", repository: "https://github.com/owner/repo" }}
        />
      </MemoryRouter>,
    );
    expect(capturedRepoUrl).toBe("https://github.com/owner/repo");
  });

  it("passes undefined repoUrl to AgentLaunchForm when no project is selected", () => {
    render(
      <MemoryRouter>
        <AgentManager sessions={[]} selectedProject={null} />
      </MemoryRouter>,
    );
    expect(capturedRepoUrl).toBeUndefined();
  });

  it("clicking an open session button minimizes it and removes the open CSS class", async () => {
    const agentName = "test-agent";
    const sessionId = "sess-1";
    const sessions = [makeSession(sessionId, agentName)];

    const { getAllByTestId } = render(
      <MemoryRouter><AgentManager sessions={sessions} selectedProject={null} /></MemoryRouter>,
    );

    const sessionButtons = getAllByTestId("sidebar-session");
    expect(sessionButtons).toHaveLength(1);
    const sessionBtn = sessionButtons[0];

    // First click: open the session — button should gain the open class
    await act(async () => {
      fireEvent.click(sessionBtn);
    });
    expect(sessionBtn.className).toContain("open");

    // Second click: session is already open, so it should be minimized
    await act(async () => {
      fireEvent.click(sessionBtn);
    });
    expect(sessionBtn.className).not.toContain("open");
  });
});
