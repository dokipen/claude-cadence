// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
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
        last_seen: "2024-01-01T00:00:00Z",
      },
    ],
    loading: false,
  })),
  normalizeRepo: (repo: string) => repo,
}));

// Mock AgentLaunchForm
vi.mock("./AgentLaunchForm", () => ({
  AgentLaunchForm: () => <div data-testid="agent-launch-form" />,
}));

// Capture onMinimize from TilingLayout so the test can invoke it
let capturedOnMinimize: ((key: string) => void) | undefined;
vi.mock("./TilingLayout", () => ({
  TilingLayout: ({ onMinimize }: { onMinimize: (key: string) => void }) => {
    capturedOnMinimize = onMinimize;
    return <div data-testid="tiling-layout" />;
  },
}));

import { AgentManager } from "./AgentManager";

afterEach(() => {
  capturedOnMinimize = undefined;
  cleanup();
});

const makeSession = (id: string, agentName: string): AgentSession => ({
  agentName,
  session: {
    id,
    name: `session-${id}`,
    agent_profile: "default",
    state: "running",
    tmux_session: `tmux-${id}`,
    created_at: "2024-01-01T00:00:00Z",
    agent_pid: 1234,
    worktree_path: "/tmp/worktree",
    repo_url: "https://github.com/example/repo",
    base_ref: "main",
  },
});

describe("AgentManager", () => {
  it("minimized session button no longer has the open CSS class", async () => {
    const agentName = "test-agent";
    const sessionId = "sess-1";
    const sessions = [makeSession(sessionId, agentName)];

    const { getAllByTestId } = render(
      <AgentManager sessions={sessions} selectedProject={null} />,
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

    // BUG: AgentManager passes `new Set([...openKeys, ...minimizedKeys])` to SessionList.
    // This means the minimized session key stays in the set passed as openKeys, so
    // the button retains the 'open' class even after minimizing.
    // The correct behavior would be that the button no longer has the 'open' class.
    expect(sessionBtn.className).not.toContain("open");
  });
});
