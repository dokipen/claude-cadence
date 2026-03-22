// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema, SessionSchema } from "../gen/hub/v1/hub_pb";
import { SessionList } from "./SessionList";
import type { Agent } from "../types";
import type { AgentSession } from "../hooks/useAllSessions";

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

afterEach(() => {
  cleanup();
});

const makeAgent = (name: string, status: "online" | "offline" = "online"): Agent =>
  create(AgentSchema, {
    name,
    profiles: {},
    status,
    lastSeen: "2024-01-01T00:00:00Z",
  });

const makeSession = (id: string, agentName: string): AgentSession => ({
  agentName,
  session: create(SessionSchema, {
    id,
    name: `session-${id}`,
    agentProfile: "default",
    state: "running",
    tmuxSession: `tmux-${id}`,
    createdAt: "2024-01-01T00:00:00Z",
    agentPid: 1234,
    repoUrl: "https://github.com/example/repo",
    baseRef: "main",
    waitingForInput: false,
  }),
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
    const { getByText } = render(
      <SessionList {...defaultProps} agents={agents} isCollapsed={true} />,
    );
    // Content stays in DOM but is aria-hidden and inert (CSS-based visibility)
    const heading = getByText("Agents");
    const contentWrapper = heading.closest('[aria-hidden="true"]');
    expect(contentWrapper).not.toBeNull();
    expect(contentWrapper?.hasAttribute("inert")).toBe(true);
    expect(getByText("my-agent")).toBeTruthy();
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

  it("renders sessions for a given agent", () => {
    const agents = [makeAgent("my-agent")];
    const sessions = [makeSession("s1", "my-agent")];
    const { getByText } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={sessions}
        isCollapsed={false}
      />,
    );
    expect(getByText("session-s1")).toBeTruthy();
  });

  it("inert is removed from content after collapse then expand (bug repro: transitionend never fires in jsdom)", () => {
    const onSessionClick = vi.fn();
    const agents = [makeAgent("my-agent")];
    const sessions = [makeSession("s1", "my-agent")];

    const { rerender, getByTestId } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={sessions}
        onSessionClick={onSessionClick}
        isCollapsed={false}
      />,
    );

    // Collapse: useEffect sets inert immediately
    rerender(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={sessions}
        onSessionClick={onSessionClick}
        isCollapsed={true}
      />,
    );

    // Expand: useEffect registers a transitionend listener with { once: true }
    // In jsdom, CSS transitions never fire, so transitionend never fires,
    // which means inert is never removed — this is the bug.
    rerender(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={sessions}
        onSessionClick={onSessionClick}
        isCollapsed={false}
      />,
    );

    // Find the content wrapper div (the one that has/had aria-hidden and inert)
    const sessionList = getByTestId("session-list");
    // The contentRef div is the direct child of sidebarRef div, which is the first
    // child of the sidebarWrapper. We query for any element with inert still set.
    const inertEl = sessionList.querySelector("[inert]");
    // After expanding, inert should be gone — but the bug leaves it set permanently
    // because transitionend never fires in jsdom.
    expect(inertEl).toBeNull();

    // Also verify that clicking the session button calls onSessionClick
    const sessionBtn = getByTestId("sidebar-session");
    fireEvent.click(sessionBtn);
    expect(onSessionClick).toHaveBeenCalledTimes(1);
  });
});
