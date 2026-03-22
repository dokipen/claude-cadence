// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Ticket } from "../types";
import type { AgentSession } from "../hooks/useAllSessions";

// Mock react-router hooks and components
const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
  Link: ({ children, to, className, "data-testid": testId }: { children: React.ReactNode; to: string; className?: string; "data-testid"?: string }) => (
    <a href={to} className={className} data-testid={testId}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}));

// Mock child components that have complex dependencies
vi.mock("./PriorityBadge", () => ({
  PriorityBadge: () => <span data-testid="priority-badge" />,
}));

vi.mock("./LabelBadge", () => ({
  LabelBadge: () => <span data-testid="label-badge" />,
}));

vi.mock("./LaunchAgentDialog", () => ({
  LaunchAgentDialog: () => <div data-testid="launch-agent-dialog" />,
}));

vi.mock("./launchConfig", () => ({
  getLaunchConfig: () => ({ buttonLabel: "Launch" }),
}));

// Mock CSS modules
vi.mock("../styles/card.module.css", () => ({ default: {} }));
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

import { TicketCard } from "./TicketCard";

afterEach(() => {
  cleanup();
  mockNavigate.mockClear();
});

const ticket: Ticket = {
  id: "t-1",
  number: 42,
  title: "Test Ticket",
  state: "BACKLOG",
  priority: "MEDIUM",
  labels: [],
  blockedBy: [],
  storyPoints: undefined,
};

const activeSession: AgentSession = {
  session: {
    id: "s-1",
    name: "lead-42",
    agent_profile: "default",
    state: "running",
    tmux_session: "lead-42",
    created_at: "2026-01-01T00:00:00Z",
    agent_pid: 1234,
    worktree_path: "/tmp/worktree",
    repo_url: "https://github.com/example/repo",
    base_ref: "main",
    waiting_for_input: false,
  },
  agentName: "lead",
};

describe("TicketCard agent-running-indicator", () => {
  it("does not render the indicator when activeSession is not provided", () => {
    const { queryByTestId } = render(<TicketCard ticket={ticket} />);
    expect(queryByTestId("agent-running-indicator")).toBeNull();
  });

  it("renders the indicator when activeSession is provided", () => {
    const { getByTestId } = render(
      <TicketCard ticket={ticket} activeSession={activeSession} />,
    );
    expect(getByTestId("agent-running-indicator")).toBeTruthy();
    const indicator = getByTestId("agent-running-indicator");
    expect(indicator.querySelector("span")).toBeTruthy();
  });

  it("sets the title attribute to the agent name", () => {
    const { getByTestId } = render(
      <TicketCard ticket={ticket} activeSession={activeSession} />,
    );
    const indicator = getByTestId("agent-running-indicator");
    expect(indicator.getAttribute("title")).toBe("lead");
  });

  it("navigates to /agents when the indicator is clicked", () => {
    const { getByTestId } = render(
      <TicketCard ticket={ticket} activeSession={activeSession} />,
    );
    fireEvent.click(getByTestId("agent-running-indicator"));
    expect(mockNavigate).toHaveBeenCalledWith("/agents");
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});
