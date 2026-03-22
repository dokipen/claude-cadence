// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { SessionList } from "./SessionList";
import type { Agent, Session } from "../types";
import type { AgentSession } from "../hooks/useAllSessions";

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

afterEach(() => {
  cleanup();
});

const makeAgent = (name: string, status: "online" | "offline" = "online"): Agent => ({
  name,
  profiles: {},
  status,
  last_seen: "2024-01-01T00:00:00Z",
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
  } satisfies Session,
});

const defaultProps = {
  agents: [],
  sessions: [],
  openKeys: new Set<string>(),
  onSessionClick: vi.fn(),
  isCollapsed: false,
  onToggle: vi.fn(),
};

describe("SessionList", () => {
  it("renders toggle button with data-testid='sidebar-toggle'", () => {
    const { getByTestId } = render(<SessionList {...defaultProps} />);
    expect(getByTestId("sidebar-toggle")).toBeTruthy();
  });

  it("toggle button has aria-expanded='true' when isCollapsed=false", () => {
    const { getByTestId } = render(<SessionList {...defaultProps} isCollapsed={false} />);
    const btn = getByTestId("sidebar-toggle");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggle button has aria-expanded='false' when isCollapsed=true", () => {
    const { getByTestId } = render(<SessionList {...defaultProps} isCollapsed={true} />);
    const btn = getByTestId("sidebar-toggle");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("session list content is visible when isCollapsed=false", () => {
    const agents = [makeAgent("my-agent")];
    const { getByText } = render(
      <SessionList {...defaultProps} agents={agents} isCollapsed={false} />,
    );
    expect(getByText("Agents")).toBeTruthy();
    expect(getByText("my-agent")).toBeTruthy();
  });

  it("session list content is hidden when isCollapsed=true", () => {
    const agents = [makeAgent("my-agent")];
    const { queryByText } = render(
      <SessionList {...defaultProps} agents={agents} isCollapsed={true} />,
    );
    expect(queryByText("Agents")).toBeNull();
    expect(queryByText("my-agent")).toBeNull();
  });

  it("clicking toggle button calls onToggle callback", () => {
    const onToggle = vi.fn();
    const { getByTestId } = render(<SessionList {...defaultProps} onToggle={onToggle} />);
    fireEvent.click(getByTestId("sidebar-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders agents in alphabetical order regardless of input order", () => {
    const agents = [
      makeAgent("zebra-agent"),
      makeAgent("mango-agent"),
      makeAgent("alpha-agent"),
    ];
    const { getAllByTestId } = render(
      <SessionList {...defaultProps} agents={agents} isCollapsed={false} />,
    );
    const rendered = getAllByTestId("sidebar-agent").map((el) => el.textContent);
    expect(rendered[0]).toContain("alpha-agent");
    expect(rendered[1]).toContain("mango-agent");
    expect(rendered[2]).toContain("zebra-agent");
  });

  it("maintains alphabetical order when agent array is re-rendered with different input order", () => {
    const initialAgents = [
      makeAgent("zebra-agent"),
      makeAgent("mango-agent"),
      makeAgent("alpha-agent"),
    ];
    const { getAllByTestId, rerender } = render(
      <SessionList {...defaultProps} agents={initialAgents} isCollapsed={false} />,
    );

    // Simulate a poll returning agents in a different order
    const reorderedAgents = [
      makeAgent("mango-agent"),
      makeAgent("alpha-agent"),
      makeAgent("zebra-agent"),
    ];
    rerender(
      <SessionList {...defaultProps} agents={reorderedAgents} isCollapsed={false} />,
    );

    const rendered = getAllByTestId("sidebar-agent").map((el) => el.textContent);
    expect(rendered[0]).toContain("alpha-agent");
    expect(rendered[1]).toContain("mango-agent");
    expect(rendered[2]).toContain("zebra-agent");
  });
});
