// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// Mock Terminal to avoid xterm dependency
vi.mock("./Terminal", () => ({
  Terminal: () => <div data-testid="terminal" />,
}));

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

// Mock hubFetch
const mockHubFetch = vi.fn();
vi.mock("../api/agentHubClient", () => ({
  hubFetch: (...args: unknown[]) => mockHubFetch(...args),
  HubError: class HubError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "HubError";
      this.status = status;
    }
  },
}));

import { TerminalWindow } from "./TerminalWindow";
import { HubError } from "../api/agentHubClient";

const baseSession = {
  id: "sess-abc",
  name: "lead-42",
  state: "running" as const,
  agent_profile: "default",
  tmux_session: "tmux-abc",
  created_at: "2026-01-01T00:00:00Z",
  agent_pid: 1234,
  worktree_path: "/tmp/worktree",
  repo_url: "https://github.com/test/repo",
  base_ref: "main",
  waiting_for_input: false,
};

describe("TerminalWindow", () => {
  beforeEach(() => {
    mockHubFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("sends DELETE with force=true when terminate is clicked", async () => {
    mockHubFetch.mockResolvedValueOnce({});
    const onTerminated = vi.fn();

    render(
      <TerminalWindow
        session={baseSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={onTerminated}
      />,
    );

    fireEvent.click(screen.getByTestId("tile-terminate"));
    await waitFor(() => expect(mockHubFetch).toHaveBeenCalled());

    expect(mockHubFetch).toHaveBeenCalledWith(
      "/agents/agent-1/sessions/sess-abc?force=true",
      { method: "DELETE" },
    );
    expect(onTerminated).toHaveBeenCalled();
  });

  it("calls onTerminated when session is already gone (404)", async () => {
    mockHubFetch.mockRejectedValueOnce(new HubError(404, "not found"));
    const onTerminated = vi.fn();

    render(
      <TerminalWindow
        session={baseSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={onTerminated}
      />,
    );

    fireEvent.click(screen.getByTestId("tile-terminate"));
    await waitFor(() => expect(mockHubFetch).toHaveBeenCalled());

    expect(onTerminated).toHaveBeenCalled();
  });

  it("does not call onTerminated on non-404 errors", async () => {
    mockHubFetch.mockRejectedValueOnce(new HubError(500, "server error"));
    const onTerminated = vi.fn();

    render(
      <TerminalWindow
        session={baseSession}
        agentName="agent-1"
        onMinimize={vi.fn()}
        onTerminated={onTerminated}
      />,
    );

    fireEvent.click(screen.getByTestId("tile-terminate"));
    await waitFor(() => expect(mockHubFetch).toHaveBeenCalled());
    expect(onTerminated).not.toHaveBeenCalled();
  });
});
