// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "../gen/hub/v1/hub_pb";
import type { AgentSession } from "../hooks/useAllSessions";
import type { Session } from "../types";
import { makeSessionStorageMock } from '../test-utils/makeSessionStorageMock';

// ---------------------------------------------------------------------------
// Hoisted mutable state
// ---------------------------------------------------------------------------
const { mockOptimisticAddSession, mockIsMobile } = vi.hoisted(() => ({
  mockOptimisticAddSession: vi.fn(),
  mockIsMobile: { value: false },
}));

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({
  default: {
    sidebarSessionOpen: "open",
    sidebarSession: "session",
    sidebarSessionMinimized: "sidebarSessionMinimized",
    mobileBackButton: "mobileBackButton",
    mobileSessionView: "mobileSessionView",
    mobileSessionContent: "mobileSessionContent",
    tilingContainer: "tilingContainer",
    agentManagerBody: "agentManagerBody",
  },
}));

// Mock useIsMobile
vi.mock("../hooks/useIsMobile", () => ({
  useIsMobile: () => mockIsMobile.value,
}));

// Mock SessionsContext
vi.mock("../hooks/SessionsContext", () => ({
  useSessionsContext: vi.fn(() => ({
    optimisticAddSession: mockOptimisticAddSession,
    optimisticSetDestroying: vi.fn(),
    optimisticResetState: vi.fn(),
  })),
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
const FAKE_LAUNCHED_SESSION = { id: "launched-sess-1", name: "my-session" } as unknown as Session;
const FAKE_LAUNCHED_AGENT = "test-agent";
vi.mock("./AgentLaunchForm", () => ({
  AgentLaunchForm: ({ repoUrl, onLaunched }: { repoUrl?: string; onLaunched: (s: Session, agentName: string) => void }) => {
    capturedRepoUrl = repoUrl;
    return (
      <div data-testid="agent-launch-form">
        <button
          data-testid="launch-trigger"
          onClick={() => onLaunched(FAKE_LAUNCHED_SESSION, FAKE_LAUNCHED_AGENT)}
        >
          Launch
        </button>
      </div>
    );
  },
}));

// Capture onMinimize and windows from TilingLayout so the tests can inspect them
let capturedOnMinimize: ((key: string) => void) | undefined;
let capturedWindows: { key: string }[] = [];
vi.mock("./TilingLayout", () => ({
  TilingLayout: ({ onMinimize, windows }: { onMinimize: (key: string) => void; windows: { key: string }[] }) => {
    capturedOnMinimize = onMinimize;
    capturedWindows = windows;
    return <div data-testid="tiling-layout" />;
  },
}));

vi.mock("./MobileSessionView", () => ({
  MobileSessionView: ({ onBack, onClose }: { onBack: () => void; onClose: () => void; win: unknown }) => (
    <div data-testid="mobile-session-view">
      <button onClick={onBack} aria-label="Back to agent list">← Back</button>
      <button onClick={onClose} aria-label="Close session">✕</button>
    </div>
  ),
}));

import { MemoryRouter } from "react-router";
import { AgentManager } from "./AgentManager";

afterEach(() => {
  capturedOnMinimize = undefined;
  capturedWindows = [];
  capturedRepoUrl = undefined;
  mockOptimisticAddSession.mockReset();
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
      <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
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
      <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
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
          sessionsLoaded={true}
          selectedProject={{ id: "p1", name: "my-project", repository: "https://github.com/owner/repo" }}
        />
      </MemoryRouter>,
    );
    expect(capturedRepoUrl).toBe("https://github.com/owner/repo");
  });

  it("passes undefined repoUrl to AgentLaunchForm when no project is selected", () => {
    render(
      <MemoryRouter>
        <AgentManager sessions={[]} sessionsLoaded={true} selectedProject={null} />
      </MemoryRouter>,
    );
    expect(capturedRepoUrl).toBeUndefined();
  });

  it("clicking an open session button minimizes it and removes the open CSS class", async () => {
    const agentName = "test-agent";
    const sessionId = "sess-1";
    const sessions = [makeSession(sessionId, agentName)];

    const { getAllByTestId } = render(
      <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
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
    expect(sessionBtn.className).toContain("sidebarSessionMinimized");
  });
});

describe("sessionStorage persistence", () => {
  let mockSessionStorage: ReturnType<typeof makeSessionStorageMock>;

  beforeEach(() => {
    mockSessionStorage = makeSessionStorageMock();
    vi.stubGlobal("sessionStorage", mockSessionStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("writes open windows to sessionStorage when a window is opened", async () => {
    const agentName = "test-agent";
    const sessionId = "sess-persist-1";
    const sessions = [makeSession(sessionId, agentName)];
    const expectedKey = `${agentName}:${sessionId}`;

    const { getAllByTestId } = render(
      <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
    );

    const sessionBtn = getAllByTestId("sidebar-session")[0];
    await act(async () => {
      fireEvent.click(sessionBtn);
    });

    const setItemCalls = mockSessionStorage.setItem.mock.calls;
    const openWindowsCalls = setItemCalls.filter(([key]) => key === "cadence_open_windows");
    expect(openWindowsCalls.length).toBeGreaterThan(0);
    const lastCall = openWindowsCalls[openWindowsCalls.length - 1];
    const stored: string[] = JSON.parse(lastCall[1]);
    expect(stored).toContain(expectedKey);
  });

  it("writes minimized windows to sessionStorage when a window is minimized", async () => {
    const agentName = "test-agent";
    const sessionId = "sess-persist-2";
    const sessions = [makeSession(sessionId, agentName)];
    const expectedKey = `${agentName}:${sessionId}`;

    const { getAllByTestId } = render(
      <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
    );

    const sessionBtn = getAllByTestId("sidebar-session")[0];

    // Open it
    await act(async () => {
      fireEvent.click(sessionBtn);
    });

    // Minimize it by clicking again
    await act(async () => {
      fireEvent.click(sessionBtn);
    });

    const setItemCalls = mockSessionStorage.setItem.mock.calls;
    const minimizedCalls = setItemCalls.filter(([key]) => key === "cadence_minimized_windows");
    expect(minimizedCalls.length).toBeGreaterThan(0);
    const lastCall = minimizedCalls[minimizedCalls.length - 1];
    const stored: string[] = JSON.parse(lastCall[1]);
    expect(stored).toContain(expectedKey);
  });

  it("rehydrates open windows from sessionStorage on mount", async () => {
    const agentName = "test-agent";
    const sessionId = "sess-rehydrate-1";
    const sessions = [makeSession(sessionId, agentName)];
    const key = `${agentName}:${sessionId}`;

    // Pre-populate sessionStorage
    mockSessionStorage.setItem("cadence_open_windows", JSON.stringify([key]));

    // Wrap in act so the deferred restore useEffect flushes before asserting
    await act(async () => {
      render(
        <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
      );
    });

    // The window should have been restored
    expect(capturedWindows.map((w) => w.key)).toContain(key);
  });

  it("defers open window rehydration until sessionsLoaded becomes true", async () => {
    const agentName = "test-agent";
    const sessionId = "sess-deferred-1";
    const sessions = [makeSession(sessionId, agentName)];
    const key = `${agentName}:${sessionId}`;

    mockSessionStorage.setItem("cadence_open_windows", JSON.stringify([key]));

    let rerender!: ReturnType<typeof render>["rerender"];

    // Mount with sessionsLoaded=false (sessions still loading) — windows should NOT be restored yet
    await act(async () => {
      ({ rerender } = render(
        <MemoryRouter><AgentManager sessions={[]} sessionsLoaded={false} selectedProject={null} /></MemoryRouter>,
      ));
    });

    // No windows should be open yet
    expect(capturedWindows).toHaveLength(0);

    // Simulate sessions finishing load: sessionsLoaded becomes true with sessions populated
    await act(async () => {
      rerender(
        <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
      );
    });

    // Now the window should be restored
    expect(capturedWindows.map((w) => w.key)).toContain(key);
  });

  it("drops stale keys from sessionStorage on mount when session no longer exists", async () => {
    const agentName = "test-agent";
    const staleKey = `${agentName}:stale-session-id`;

    // Pre-populate with a key that matches no provided session
    mockSessionStorage.setItem("cadence_open_windows", JSON.stringify([staleKey]));

    // Render with sessionsLoaded=true and no matching sessions — stale key should be dropped.
    // Wrap in act to ensure all effects (including the persistence useEffect) flush.
    await act(async () => {
      render(
        <MemoryRouter><AgentManager sessions={[]} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
      );
    });

    // The effect should have written an empty array back to sessionStorage
    const setItemCalls = mockSessionStorage.setItem.mock.calls;
    const openWindowsCalls = setItemCalls.filter(([key]) => key === "cadence_open_windows");
    expect(openWindowsCalls.length).toBeGreaterThan(0);
    const lastCall = openWindowsCalls[openWindowsCalls.length - 1];
    const stored: string[] = JSON.parse(lastCall[1]);
    expect(stored).toHaveLength(0);
  });

  it("rehydrates minimized windows from sessionStorage on mount", async () => {
    const agentName = "test-agent";
    const sessionId = "sess-rehydrate-min-1";
    const sessions = [makeSession(sessionId, agentName)];
    const key = `${agentName}:${sessionId}`;

    // Pre-populate minimized windows
    mockSessionStorage.setItem("cadence_minimized_windows", JSON.stringify([key]));

    let getAllByTestId!: ReturnType<typeof render>["getAllByTestId"];
    // Wrap in act so the deferred restore useEffect flushes before asserting
    await act(async () => {
      ({ getAllByTestId } = render(
        <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
      ));
    });

    // The session button should have the minimized CSS class
    const sessionBtn = getAllByTestId("sidebar-session")[0];
    expect(sessionBtn.className).toContain("sidebarSessionMinimized");
  });
});

describe("projectId race condition — #532", () => {
  let mockSessionStorage: ReturnType<typeof makeSessionStorageMock>;

  beforeEach(() => {
    mockSessionStorage = makeSessionStorageMock();
    vi.stubGlobal("sessionStorage", mockSessionStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("restores windows with the correct projectId when selectedProject loads after sessionsLoaded", async () => {
    // Session whose name matches the /lead-42/ ticket pattern
    const agentName = "test-agent";
    const sessionId = "sess-lead-42";
    const sessionName = "proj-cuid-lead-42";
    const projectId = "proj-cuid";

    const sessions: AgentSession[] = [
      {
        agentName,
        session: create(SessionSchema, {
          id: sessionId,
          name: sessionName,
          agentProfile: "default",
          state: "running",
          createdAt: "2024-01-01T00:00:00Z",
          agentPid: 1234,
          repoUrl: "https://github.com/example/repo",
          baseRef: "main",
          waitingForInput: false,
        }),
      },
    ];

    const key = `${agentName}:${sessionId}`;

    // Pre-seed sessionStorage as if the window was previously open
    mockSessionStorage.setItem("cadence_open_windows", JSON.stringify([key]));

    let rerender!: ReturnType<typeof render>["rerender"];

    // Step 1: Mount with sessionsLoaded=false and no project — restore effect is blocked
    await act(async () => {
      ({ rerender } = render(
        <MemoryRouter>
          <AgentManager sessions={[]} sessionsLoaded={false} selectedProject={null} />
        </MemoryRouter>,
      ));
    });

    expect(capturedWindows).toHaveLength(0);

    // Step 2: Sessions finish loading, but selectedProject is still null (race condition)
    await act(async () => {
      rerender(
        <MemoryRouter>
          <AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} />
        </MemoryRouter>,
      );
    });

    // The window should be restored now (hasRestoredRef.current = true), but with projectId=undefined
    expect(capturedWindows.map((w) => w.key)).toContain(key);

    // Step 3: The project finally loads — this should update the window's projectId
    await act(async () => {
      rerender(
        <MemoryRouter>
          <AgentManager
            sessions={sessions}
            sessionsLoaded={true}
            selectedProject={{ id: projectId, name: "My Project" }}
          />
        </MemoryRouter>,
      );
    });

    // Assert that the restored window has the correct projectId.
    // With the bug, hasRestoredRef blocks the effect from re-running, so projectId stays undefined.
    const restoredWindow = capturedWindows.find((w) => w.key === key) as
      | { key: string; projectId?: string }
      | undefined;

    expect(restoredWindow).toBeDefined();
    // This assertion FAILS with the current buggy code: projectId is undefined instead of "proj-cuid"
    expect(restoredWindow?.projectId).toBe(projectId);
  });
});

describe("AgentManager — auto-open on launch", () => {
  it("opens a tiled window for the new session after form submission", async () => {
    const { getByTestId } = render(
      <MemoryRouter><AgentManager sessions={[]} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(getByTestId("launch-trigger"));
    });

    const expectedKey = `${FAKE_LAUNCHED_AGENT}:${FAKE_LAUNCHED_SESSION.id}`;
    expect(capturedWindows.some((w) => w.key === expectedKey)).toBe(true);
  });

  it("calls optimisticAddSession with the new session", async () => {
    const { getByTestId } = render(
      <MemoryRouter><AgentManager sessions={[]} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(getByTestId("launch-trigger"));
    });

    expect(mockOptimisticAddSession).toHaveBeenCalledWith(FAKE_LAUNCHED_SESSION, FAKE_LAUNCHED_AGENT);
  });

  it("does not add a duplicate window if launched twice with the same session", async () => {
    const { getByTestId } = render(
      <MemoryRouter><AgentManager sessions={[]} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(getByTestId("launch-trigger"));
    });
    await act(async () => {
      fireEvent.click(getByTestId("launch-trigger"));
    });

    const expectedKey = `${FAKE_LAUNCHED_AGENT}:${FAKE_LAUNCHED_SESSION.id}`;
    const matches = capturedWindows.filter((w) => w.key === expectedKey);
    expect(matches).toHaveLength(1);
  });
});

describe("AgentManager — mobile layout", () => {
  beforeEach(() => {
    mockIsMobile.value = true;
  });

  afterEach(() => {
    mockIsMobile.value = false;
    cleanup();
  });

  it("shows the session list and no session overlay by default on mobile", () => {
    const sessions = [makeSession("sess-m1", "test-agent")];
    const { queryByTestId, getAllByTestId } = render(
      <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
    );

    // No MobileSessionView overlay in list view
    expect(queryByTestId("mobile-session-view")).toBeNull();

    // Session list is rendered
    expect(getAllByTestId("sidebar-session").length).toBeGreaterThan(0);

    // TilingLayout is not rendered on mobile
    expect(queryByTestId("tiling-layout")).toBeNull();
  });

  it("shows MobileSessionView when a session is clicked on mobile", async () => {
    const sessions = [makeSession("sess-m2", "test-agent")];
    const { queryByTestId, getAllByTestId } = render(
      <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(getAllByTestId("sidebar-session")[0]);
    });

    // MobileSessionView overlay is shown
    expect(queryByTestId("mobile-session-view")).not.toBeNull();

    // TilingLayout is still not rendered (mobile uses MobileSessionView)
    expect(queryByTestId("tiling-layout")).toBeNull();
  });

  it("shows the Back button in session view on mobile", async () => {
    const sessions = [makeSession("sess-m3", "test-agent")];
    const { getAllByTestId, getByRole } = render(
      <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(getAllByTestId("sidebar-session")[0]);
    });

    const backButton = getByRole("button", { name: /back to agent list/i });
    expect(backButton).not.toBeNull();
  });

  it("clicking the Back button returns to list view on mobile", async () => {
    const sessions = [makeSession("sess-m4", "test-agent")];
    const { queryByTestId, getAllByTestId, getByRole } = render(
      <MemoryRouter><AgentManager sessions={sessions} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
    );

    // Open a session
    await act(async () => {
      fireEvent.click(getAllByTestId("sidebar-session")[0]);
    });

    // Click Back
    await act(async () => {
      fireEvent.click(getByRole("button", { name: /back to agent list/i }));
    });

    // Should be back to list view: no MobileSessionView overlay
    expect(queryByTestId("mobile-session-view")).toBeNull();
  });

  it("switches to session view when a session is launched on mobile", async () => {
    const { queryByTestId, getByTestId } = render(
      <MemoryRouter><AgentManager sessions={[]} sessionsLoaded={true} selectedProject={null} /></MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(getByTestId("launch-trigger"));
    });

    // Should be in session view
    expect(queryByTestId("mobile-session-view")).not.toBeNull();
  });

});
