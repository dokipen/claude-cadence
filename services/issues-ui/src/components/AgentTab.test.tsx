// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

// Mock Terminal to avoid xterm dependency
vi.mock("./Terminal", () => ({
  Terminal: () => <div data-testid="terminal" />,
}));

// Mock AgentLauncher
vi.mock("./AgentLauncher", () => ({
  AgentLauncher: () => <div data-testid="agent-launcher" />,
}));

// Mock hubFetch
const mockHubFetch = vi.fn();
vi.mock("../api/agentHubClient", () => ({
  hubFetch: (...args: unknown[]) => mockHubFetch(...args),
}));

// Mock useAgents
const mockUseAgents = vi.fn();
vi.mock("../hooks/useAgents", () => ({
  useAgents: () => mockUseAgents(),
}));

// Mock useSessionsContext
const mockOptimisticSetDestroying = vi.fn();
const mockOptimisticAddSession = vi.fn();
vi.mock("../hooks/SessionsContext", () => ({
  useSessionsContext: () => ({
    optimisticSetDestroying: mockOptimisticSetDestroying,
    optimisticAddSession: mockOptimisticAddSession,
  }),
}));

import { AgentTab } from "./AgentTab";

const defaultProps = {
  ticketNumber: 42,
  ticketTitle: "Test ticket",
  ticketState: "REFINED" as const,
  repoUrl: undefined,
};

describe("AgentTab", () => {
  beforeEach(() => {
    mockHubFetch.mockReset();
    mockOptimisticSetDestroying.mockReset();
    mockOptimisticAddSession.mockReset();
    // Default: one online agent
    mockUseAgents.mockReturnValue({ agents: [{ name: "agent-1", status: "online" }], loading: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("skips DELETE and warns when session.id is invalid", async () => {
    // Discovery returns a session with an invalid id
    mockHubFetch.mockResolvedValueOnce({
      sessions: [{ id: "../evil", name: "lead-42", state: "running" }],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<AgentTab {...defaultProps} />);

    // Wait for discovery to complete and the destroy button to appear
    await waitFor(() => expect(screen.getByTestId("destroy-session")).toBeDefined());

    mockHubFetch.mockReset();
    fireEvent.click(screen.getByTestId("destroy-session"));

    expect(warnSpy).toHaveBeenCalledWith(
      "[AgentTab] Refusing to delete session: invalid id",
    );
    expect(mockHubFetch).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
