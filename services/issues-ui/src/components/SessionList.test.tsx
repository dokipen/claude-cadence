// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentSchema, SessionSchema } from "../gen/hub/v1/hub_pb";
import { SessionList } from "./SessionList";
import type { Agent, AgentStatus } from "../types";
import type { AgentSession } from "../hooks/useAllSessions";

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

// Mock agentHubClient so button tests don't need a real WebSocket
vi.mock("../api/agentHubClient", () => ({
  deleteSession: vi.fn().mockResolvedValue(undefined),
  sendSessionInput: vi.fn().mockResolvedValue(undefined),
}));

// Mock SessionOutputTooltip so tests don't need xterm/WebSocket setup
vi.mock("./SessionOutputTooltip", () => ({
  SessionOutputTooltip: ({ children, session }: { children: React.ReactNode; session: { sessionId: string } }) => (
    <div data-testid="session-output-tooltip-wrapper" data-session-id={session.sessionId}>{children}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const makeAgent = (name: string, status: AgentStatus = "online"): Agent =>
  create(AgentSchema, {
    name,
    profiles: {},
    status,
    lastSeen: "2024-01-01T00:00:00Z",
  }) as unknown as Agent;

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

const defaultProps = {
  agents: [],
  sessions: [],
  openKeys: new Set<string>(),
  minimizedKeys: new Set<string>(),
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

  it("destroying session shows ● icon (not ○)", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "destroying";
    const { getByTestId } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[session]}
        isCollapsed={false}
      />,
    );
    const btn = getByTestId("sidebar-session");
    expect(btn.textContent).toContain("●");
    expect(btn.textContent).not.toContain("○");
  });

  it("waitingForInput=true takes precedence over state=destroying: shows ◉ not ●", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "destroying";
    session.session.waitingForInput = true;
    const { getByTestId } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[session]}
        isCollapsed={false}
      />,
    );
    const btn = getByTestId("sidebar-session");
    expect(btn.textContent).toContain("◉");
    expect(btn.textContent).not.toContain("●");
  });

  it("stopped session shows ○ icon while destroying session shows ●", () => {
    const agents = [makeAgent("my-agent")];
    const destroyingSession = makeSession("s2", "my-agent");
    destroyingSession.session.state = "destroying";

    const stoppedSession = makeSession("s3", "my-agent");
    stoppedSession.session.state = "stopped";

    const { getAllByTestId } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[destroyingSession, stoppedSession]}
        isCollapsed={false}
      />,
    );

    const btns = getAllByTestId("sidebar-session");
    const destroyingBtn = btns.find((b) => b.getAttribute("title")?.includes("destroying"));
    const stoppedBtn = btns.find((b) => b.getAttribute("title")?.includes("stopped"));

    expect(destroyingBtn).toBeTruthy();
    expect(stoppedBtn).toBeTruthy();
    expect(destroyingBtn?.textContent).toContain("●");
    expect(stoppedBtn?.textContent).toContain("○");
  });

  it("strips CUID project prefix from session name display", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    // 25-char CUID + "-" + session name
    session.session.name = "cmmryin270000ny01dc2msx3t-lead-42";
    const { getByText, queryByText } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[session]}
        isCollapsed={false}
      />,
    );
    expect(getByText("lead-42")).toBeTruthy();
    expect(queryByText("cmmryin270000ny01dc2msx3t-lead-42")).toBeNull();
  });

  it("displays session name as-is when there is no CUID prefix", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.name = "lead-42";
    const { getByText } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[session]}
        isCollapsed={false}
      />,
    );
    expect(getByText("lead-42")).toBeTruthy();
  });

  it("running session is wrapped with SessionOutputTooltip", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "running";
    const { getByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(getByTestId("session-output-tooltip-wrapper")).toBeTruthy();
    expect(getByTestId("session-output-tooltip-wrapper").getAttribute("data-session-id")).toBe("s1");
  });

  it("creating session is wrapped with SessionOutputTooltip", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "creating";
    const { getByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(getByTestId("session-output-tooltip-wrapper")).toBeTruthy();
  });

  it("destroying session is wrapped with SessionOutputTooltip", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "destroying";
    const { getByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(getByTestId("session-output-tooltip-wrapper")).toBeTruthy();
  });

  it("stopped session is not wrapped with SessionOutputTooltip", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "stopped";
    const { queryByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(queryByTestId("session-output-tooltip-wrapper")).toBeNull();
  });

  it("error session is not wrapped with SessionOutputTooltip", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "error";
    const { queryByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(queryByTestId("session-output-tooltip-wrapper")).toBeNull();
  });

  it("displays full name when string is exactly 26 chars (no session name after prefix)", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    // Exactly 26 chars: 25-char CUID + "-" with nothing after — not long enough to strip
    session.session.name = "cmmryin270000ny01dc2msx3t-";
    const { getByText } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[session]}
        isCollapsed={false}
      />,
    );
    expect(getByText("cmmryin270000ny01dc2msx3t-")).toBeTruthy();
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

  describe("status display states (data-status)", () => {
    it("destroying session has data-status='closing' regardless of waitingForInput", () => {
      const agents = [makeAgent("my-agent")];
      const session = makeSession("s1", "my-agent");
      session.session.state = "destroying";
      session.session.waitingForInput = true;
      const { getByTestId } = render(
        <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
      );
      expect(getByTestId("sidebar-session").getAttribute("data-status")).toBe("closing");
    });

    it("open panel session has data-status='open' even when waitingForInput=true", () => {
      const agents = [makeAgent("my-agent")];
      const session = makeSession("s1", "my-agent");
      session.session.state = "running";
      session.session.waitingForInput = true;
      const key = "my-agent:s1";
      const { getByTestId } = render(
        <SessionList
          {...defaultProps}
          agents={agents}
          sessions={[session]}
          openKeys={new Set([key])}
          isCollapsed={false}
        />,
      );
      expect(getByTestId("sidebar-session").getAttribute("data-status")).toBe("open");
    });

    it("running session with closed panel and waitingForInput=true has data-status='waiting'", () => {
      const agents = [makeAgent("my-agent")];
      const session = makeSession("s1", "my-agent");
      session.session.state = "running";
      session.session.waitingForInput = true;
      const { getByTestId } = render(
        <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
      );
      expect(getByTestId("sidebar-session").getAttribute("data-status")).toBe("waiting");
    });

    it("running session with closed panel and waitingForInput=false has data-status='closed'", () => {
      const agents = [makeAgent("my-agent")];
      const session = makeSession("s1", "my-agent");
      session.session.state = "running";
      session.session.waitingForInput = false;
      const { getByTestId } = render(
        <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
      );
      expect(getByTestId("sidebar-session").getAttribute("data-status")).toBe("closed");
    });

    it("stopped session has data-status='stopped'", () => {
      const agents = [makeAgent("my-agent")];
      const session = makeSession("s1", "my-agent");
      session.session.state = "stopped";
      session.session.waitingForInput = false;
      const { getByTestId } = render(
        <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
      );
      expect(getByTestId("sidebar-session").getAttribute("data-status")).toBe("stopped");
    });

    it("creating session has data-status='creating'", () => {
      const agents = [makeAgent("my-agent")];
      const session = makeSession("s1", "my-agent");
      session.session.state = "creating";
      session.session.waitingForInput = false;
      const { getByTestId } = render(
        <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
      );
      expect(getByTestId("sidebar-session").getAttribute("data-status")).toBe("creating");
    });

    it("destroying session with waitingForInput=false has data-status='closing'", () => {
      const agents = [makeAgent("my-agent")];
      const session = makeSession("s1", "my-agent");
      session.session.state = "destroying";
      session.session.waitingForInput = false;
      const { getByTestId } = render(
        <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
      );
      expect(getByTestId("sidebar-session").getAttribute("data-status")).toBe("closing");
    });

    it("destroying session with open panel has data-status='closing' (closing beats open)", () => {
      const agents = [makeAgent("my-agent")];
      const session = makeSession("s1", "my-agent");
      session.session.state = "destroying";
      const key = "my-agent:s1";
      const { getByTestId } = render(
        <SessionList
          {...defaultProps}
          agents={agents}
          sessions={[session]}
          openKeys={new Set([key])}
          isCollapsed={false}
        />,
      );
      expect(getByTestId("sidebar-session").getAttribute("data-status")).toBe("closing");
    });
  });

  it("kill button is present for a running session", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "running";
    const { getByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(getByTestId("sidebar-session-kill")).toBeTruthy();
  });

  it("kill button is absent for a stopped session", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "stopped";
    const { queryByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(queryByTestId("sidebar-session-kill")).toBeNull();
  });

  it("clicking kill button calls deleteSession and stops event propagation", async () => {
    const { deleteSession } = await import("../api/agentHubClient");
    const onSessionClick = vi.fn();
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "running";
    const { getByTestId } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[session]}
        onSessionClick={onSessionClick}
        isCollapsed={false}
      />,
    );
    fireEvent.click(getByTestId("sidebar-session-kill"));
    expect(deleteSession).toHaveBeenCalledWith("my-agent", "s1");
    expect(onSessionClick).not.toHaveBeenCalled();
  });

  it("pressing Esc on an open session calls onSessionClick", () => {
    const onSessionClick = vi.fn();
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    const key = `my-agent:s1`;
    const { getByTestId } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[session]}
        openKeys={new Set([key])}
        onSessionClick={onSessionClick}
        isCollapsed={false}
      />,
    );
    fireEvent.keyDown(getByTestId("sidebar-session"), { key: "Escape" });
    expect(onSessionClick).toHaveBeenCalledTimes(1);
  });

  it("pressing Esc on a minimized session calls onSessionClick", () => {
    const onSessionClick = vi.fn();
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    const key = `my-agent:s1`;
    const { getByTestId } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[session]}
        minimizedKeys={new Set([key])}
        onSessionClick={onSessionClick}
        isCollapsed={false}
      />,
    );
    fireEvent.keyDown(getByTestId("sidebar-session"), { key: "Escape" });
    expect(onSessionClick).toHaveBeenCalledTimes(1);
  });

  it("pressing Esc on a session that is neither open nor minimized does not call onSessionClick", () => {
    const onSessionClick = vi.fn();
    const agents = [makeAgent("my-agent")];
    const sessions = [makeSession("s1", "my-agent")];
    const { getByTestId } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={sessions}
        onSessionClick={onSessionClick}
        isCollapsed={false}
      />,
    );
    fireEvent.keyDown(getByTestId("sidebar-session"), { key: "Escape" });
    expect(onSessionClick).not.toHaveBeenCalled();
  });

  it("return button is present for a running session", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "running";
    const { getByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(getByTestId("sidebar-session-return")).toBeTruthy();
  });

  it("esc button is present for a running session", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "running";
    const { getByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(getByTestId("sidebar-session-esc")).toBeTruthy();
  });

  it("return button is absent for a stopped session", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "stopped";
    const { queryByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(queryByTestId("sidebar-session-return")).toBeNull();
  });

  it("esc button is absent for a stopped session", () => {
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "stopped";
    const { queryByTestId } = render(
      <SessionList {...defaultProps} agents={agents} sessions={[session]} isCollapsed={false} />,
    );
    expect(queryByTestId("sidebar-session-esc")).toBeNull();
  });

  it("clicking return button calls sendSessionInput with carriage return and stops propagation", async () => {
    const { sendSessionInput } = await import("../api/agentHubClient");
    const onSessionClick = vi.fn();
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "running";
    const { getByTestId } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[session]}
        onSessionClick={onSessionClick}
        isCollapsed={false}
      />,
    );
    fireEvent.click(getByTestId("sidebar-session-return"));
    expect(sendSessionInput).toHaveBeenCalledWith("my-agent", "s1", "\r");
    expect(onSessionClick).not.toHaveBeenCalled();
  });

  it("clicking esc button calls sendSessionInput with escape character and stops propagation", async () => {
    const { sendSessionInput } = await import("../api/agentHubClient");
    const onSessionClick = vi.fn();
    const agents = [makeAgent("my-agent")];
    const session = makeSession("s1", "my-agent");
    session.session.state = "running";
    const { getByTestId } = render(
      <SessionList
        {...defaultProps}
        agents={agents}
        sessions={[session]}
        onSessionClick={onSessionClick}
        isCollapsed={false}
      />,
    );
    fireEvent.click(getByTestId("sidebar-session-esc"));
    expect(sendSessionInput).toHaveBeenCalledWith("my-agent", "s1", "\x1b");
    expect(onSessionClick).not.toHaveBeenCalled();
  });
});
