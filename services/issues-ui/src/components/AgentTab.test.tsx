// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "../gen/hub/v1/hub_pb";
import type { Session } from "../types";

// ---------------------------------------------------------------------------
// Hoisted mutable state shared between mock factories and tests
// ---------------------------------------------------------------------------
const { mockHubFetch, mockOptimisticSetDestroying, mockOptimisticAddSession, mockAgents, mockAgentsLoading } = vi.hoisted(() => ({
  mockHubFetch: vi.fn(),
  mockOptimisticSetDestroying: vi.fn(),
  mockOptimisticAddSession: vi.fn(),
  // Mutable containers so each test can change the value without re-mocking
  mockAgents: { current: [] as { name: string; status: string }[] },
  mockAgentsLoading: { current: false },
}));

// ---------------------------------------------------------------------------
// CSS module mocks — must come before component imports
// ---------------------------------------------------------------------------
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

// ---------------------------------------------------------------------------
// agentHubClient — only hubFetch is used by AgentTab directly
// ---------------------------------------------------------------------------
vi.mock("../api/agentHubClient", () => ({
  hubFetch: mockHubFetch,
  HubError: class HubError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "HubError";
      this.status = status;
    }
  },
}));

// ---------------------------------------------------------------------------
// useAgents — controls which agents are visible and loading state
// ---------------------------------------------------------------------------
vi.mock("../hooks/useAgents", () => ({
  useAgents: vi.fn(() => ({
    agents: mockAgents.current,
    loading: mockAgentsLoading.current,
    error: null,
  })),
  useAgentProfiles: vi.fn(() => []),
  normalizeRepo: (repo: string) => repo,
}));

// ---------------------------------------------------------------------------
// SessionsContext — supply optimistic fn mocks
// ---------------------------------------------------------------------------
vi.mock("../hooks/SessionsContext", () => ({
  useSessionsContext: vi.fn(() => ({
    optimisticSetDestroying: mockOptimisticSetDestroying,
    optimisticResetState: vi.fn(),
    optimisticAddSession: mockOptimisticAddSession,
  })),
  SessionsContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));

// ---------------------------------------------------------------------------
// AgentLauncher stub — calls onLaunched with a deterministic test session
// ---------------------------------------------------------------------------
vi.mock("./AgentLauncher", () => ({
  AgentLauncher: ({
    onLaunched,
  }: {
    onLaunched: (session: Session, agentName: string) => void;
  }) => (
    <button
      data-testid="agent-launcher"
      onClick={() => onLaunched(makeLaunchedSession(), "test-agent")}
    >
      Launch
    </button>
  ),
}));

// ---------------------------------------------------------------------------
// Terminal stub
// ---------------------------------------------------------------------------
vi.mock("./Terminal", () => ({
  Terminal: () => <div data-testid="terminal" />,
}));

// ---------------------------------------------------------------------------
// launchConfig — stable deterministic values for all ticket states
// ---------------------------------------------------------------------------
vi.mock("./launchConfig", () => ({
  getLaunchConfig: vi.fn(() => ({
    buttonLabel: "Lead",
    command: (n: number) => `/lead ${n}`,
    sessionName: (n: number) => `lead-${n}`,
  })),
}));

// ---------------------------------------------------------------------------
// Component under test — imported AFTER all vi.mock calls
// ---------------------------------------------------------------------------
import { AgentTab } from "./AgentTab";

// ---------------------------------------------------------------------------
// Session factory helpers
// ---------------------------------------------------------------------------
function makeSession(
  overrides: Partial<{
    id: string;
    name: string;
    state: string;
    agentProfile: string;
  }> = {},
): Session {
  return create(SessionSchema, {
    id: overrides.id ?? "sess-1",
    name: overrides.name ?? "lead-42",
    state: overrides.state ?? "running",
    agentProfile: overrides.agentProfile ?? "default",
    createdAt: "2024-01-01T00:00:00Z",
    agentPid: 1234,
    repoUrl: "https://github.com/example/repo",
    baseRef: "main",
    waitingForInput: false,
  }) as unknown as Session;
}

// Session returned by the AgentLauncher stub when "Launch" is clicked
function makeLaunchedSession(): Session {
  return makeSession({ id: "launched-sess", name: "lead-42", state: "running" });
}

// ---------------------------------------------------------------------------
// Default props for AgentTab
// ---------------------------------------------------------------------------
const defaultProps = {
  ticketNumber: 42,
  ticketTitle: "Test ticket",
  ticketState: "REFINED" as const,
  repoUrl: "https://github.com/example/repo",
};

// ---------------------------------------------------------------------------
// Helper: flush all pending microtasks and resolved promises inside act()
// ---------------------------------------------------------------------------
async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Test setup / teardown (no fake timers by default — findBy* depends on real timers)
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockHubFetch.mockReset();
  mockOptimisticSetDestroying.mockReset();
  mockOptimisticAddSession.mockReset();
  // Default: single online agent, agents have finished loading
  mockAgents.current = [{ name: "test-agent", status: "online" }];
  mockAgentsLoading.current = false;
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AgentTab", () => {
  describe("discovery phase", () => {
    it('shows "Checking for active sessions…" while agents are still loading', () => {
      mockAgentsLoading.current = true;
      // hubFetch never resolves while loading — keep it pending
      mockHubFetch.mockReturnValue(new Promise(() => {}));

      const { getByText } = render(<AgentTab {...defaultProps} />);

      expect(getByText("Checking for active sessions…")).toBeTruthy();
    });

    it("shows AgentLauncher when no active session found after discovery", async () => {
      mockHubFetch.mockResolvedValueOnce({ sessions: [] });

      const { getByTestId } = render(<AgentTab {...defaultProps} />);

      await flushAsync();

      expect(getByTestId("agent-launcher")).toBeTruthy();
    });

    it("shows AgentLauncher when no online agents exist", async () => {
      mockAgents.current = [];

      const { getByTestId } = render(<AgentTab {...defaultProps} />);

      await flushAsync();

      expect(getByTestId("agent-launcher")).toBeTruthy();
    });
  });

  describe("creating state", () => {
    it('shows "Agent session starting…" when discovered session state is "creating"', async () => {
      const creatingSession = makeSession({ id: "sess-creating", name: "lead-42", state: "creating" });
      mockHubFetch.mockResolvedValueOnce({ sessions: [creatingSession] });

      const { getByText } = render(<AgentTab {...defaultProps} />);

      await flushAsync();

      expect(getByText("Agent session starting…")).toBeTruthy();
    });
  });

  describe("running state", () => {
    it("shows terminal when discovered session state is running", async () => {
      const runningSession = makeSession({ id: "sess-running", name: "lead-42", state: "running" });
      mockHubFetch.mockResolvedValueOnce({ sessions: [runningSession] });

      const { getByTestId } = render(<AgentTab {...defaultProps} />);

      await flushAsync();

      expect(getByTestId("terminal")).toBeTruthy();
    });

    it('shows "Destroy Session" button when session is running', async () => {
      const runningSession = makeSession({ id: "sess-running", name: "lead-42", state: "running" });
      mockHubFetch.mockResolvedValueOnce({ sessions: [runningSession] });

      const { getByTestId } = render(<AgentTab {...defaultProps} />);

      await flushAsync();

      const btn = getByTestId("destroy-session");
      expect(btn.textContent).toBe("Destroy Session");
    });
  });

  describe("handleDestroy", () => {
    it("skips DELETE and warns when session.id is invalid", async () => {
      // Discovery returns a session with an invalid id (path traversal attempt)
      mockHubFetch.mockResolvedValueOnce({
        sessions: [{ id: "../evil", name: "lead-42", state: "running" }],
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { findByTestId } = render(<AgentTab {...defaultProps} />);
      const destroyBtn = await findByTestId("destroy-session");

      mockHubFetch.mockReset();
      fireEvent.click(destroyBtn);

      expect(warnSpy).toHaveBeenCalledWith(
        "[AgentTab] Refusing to delete session: invalid id or agentName",
      );
      expect(mockHubFetch).not.toHaveBeenCalled();
      expect(mockOptimisticSetDestroying).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("skips DELETE and warns when agentName is invalid", async () => {
      // Use an agent whose name contains spaces — validateAgentProfile rejects it.
      // AgentTab sets active.agentName from the matched agent.name during discovery.
      mockAgents.current = [{ name: "bad agent name", status: "online" }];
      mockHubFetch.mockResolvedValueOnce({
        sessions: [{ id: "sess-valid-1", name: "lead-42", state: "running" }],
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { findByTestId } = render(<AgentTab {...defaultProps} />);
      const destroyBtn = await findByTestId("destroy-session");

      mockHubFetch.mockReset();
      fireEvent.click(destroyBtn);

      expect(warnSpy).toHaveBeenCalledWith(
        "[AgentTab] Refusing to delete session: invalid id or agentName",
      );
      expect(mockHubFetch).not.toHaveBeenCalled();
      expect(mockOptimisticSetDestroying).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("calls optimisticSetDestroying and hub DELETE endpoint on destroy", async () => {
      const runningSession = makeSession({ id: "sess-del", name: "lead-42", state: "running" });
      // First call: discovery; second call: DELETE
      mockHubFetch
        .mockResolvedValueOnce({ sessions: [runningSession] })
        .mockResolvedValueOnce(undefined);

      const { getByTestId } = render(<AgentTab {...defaultProps} />);
      await flushAsync();

      const btn = getByTestId("destroy-session");

      await act(async () => {
        fireEvent.click(btn);
      });

      expect(mockOptimisticSetDestroying).toHaveBeenCalledWith("sess-del");
      expect(mockHubFetch).toHaveBeenCalledWith(
        expect.stringContaining("sess-del"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("removes the terminal after destroy completes", async () => {
      const runningSession = makeSession({ id: "sess-del2", name: "lead-42", state: "running" });
      mockHubFetch
        .mockResolvedValueOnce({ sessions: [runningSession] })
        .mockResolvedValueOnce(undefined);

      const { getByTestId, queryByTestId } = render(<AgentTab {...defaultProps} />);
      await flushAsync();

      const btn = getByTestId("destroy-session");

      await act(async () => {
        fireEvent.click(btn);
      });

      expect(queryByTestId("terminal")).toBeNull();
    });

    it('"Destroy Session" button is disabled while destroying is in progress', async () => {
      const runningSession = makeSession({ id: "sess-destroying", name: "lead-42", state: "running" });
      // Discovery resolves immediately; DELETE stays pending so `destroying` stays true
      let resolveDelete!: () => void;
      const pendingDelete = new Promise<void>((res) => {
        resolveDelete = res;
      });
      mockHubFetch
        .mockResolvedValueOnce({ sessions: [runningSession] })
        .mockReturnValueOnce(pendingDelete);

      const { getByTestId } = render(<AgentTab {...defaultProps} />);
      await flushAsync();

      const btn = getByTestId("destroy-session");
      expect(btn).not.toBeDisabled();

      // Click destroy — do not await so the pending promise keeps destroying=true
      act(() => {
        fireEvent.click(btn);
      });

      // Give the async handleDestroy a chance to set destroying=true
      await act(async () => {
        await Promise.resolve();
      });

      expect(btn).toBeDisabled();

      // Clean up pending promise to avoid open handle
      await act(async () => {
        resolveDelete();
      });
    });
  });

  describe("handleLaunched", () => {
    it("calls optimisticAddSession and shows terminal when launcher fires onLaunched", async () => {
      // Discovery finds nothing — launcher is shown
      mockHubFetch.mockResolvedValueOnce({ sessions: [] });

      const { getByTestId } = render(<AgentTab {...defaultProps} />);
      await flushAsync();

      const launchBtn = getByTestId("agent-launcher");

      await act(async () => {
        fireEvent.click(launchBtn);
      });

      // optimisticAddSession called with the launched session and agent name
      expect(mockOptimisticAddSession).toHaveBeenCalledTimes(1);
      const [sessionArg, agentNameArg] = mockOptimisticAddSession.mock.calls[0];
      expect(sessionArg.id).toBe("launched-sess");
      expect(agentNameArg).toBe("test-agent");

      // Terminal should now be visible
      expect(getByTestId("terminal")).toBeTruthy();
    });
  });

  describe("session polling for creating -> running transition", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("polls hubFetch and transitions from creating to running", async () => {
      const creatingSession = makeSession({ id: "sess-poll", name: "lead-42", state: "creating" });
      const runningSession = makeSession({ id: "sess-poll", name: "lead-42", state: "running" });

      // Discovery returns creating session; poll call returns running session
      mockHubFetch
        .mockResolvedValueOnce({ sessions: [creatingSession] })
        .mockResolvedValueOnce({ sessions: [runningSession] });

      const { getByText, queryByTestId } = render(<AgentTab {...defaultProps} />);

      // Flush discovery promise
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(getByText("Agent session starting…")).toBeTruthy();
      expect(queryByTestId("terminal")).toBeNull();

      // Advance timer to trigger the poll interval (SESSION_POLL_MS = 3000)
      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(queryByTestId("terminal")).toBeTruthy();
    });
  });
});
