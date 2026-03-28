// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "../gen/hub/v1/hub_pb";
import type { AgentSession } from "../hooks/useAllSessions";
import { makeSessionStorageMock } from '../test-utils/makeSessionStorageMock';

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({
  default: {
    sidebarSessionOpen: "open",
    sidebarSession: "session",
    sidebarSessionMinimized: "sidebarSessionMinimized",
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
      <MemoryRouter><AgentManager sessions={sessions} selectedProject={null} /></MemoryRouter>,
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
      <MemoryRouter><AgentManager sessions={sessions} selectedProject={null} /></MemoryRouter>,
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

    const { getByTestId } = render(
      <MemoryRouter><AgentManager sessions={sessions} selectedProject={null} /></MemoryRouter>,
    );

    // TilingLayout should be rendered (not the empty state), meaning window is open
    expect(getByTestId("tiling-layout")).toBeDefined();
  });

  it("drops stale keys from sessionStorage on mount when session no longer exists", async () => {
    const agentName = "test-agent";
    const staleKey = `${agentName}:stale-session-id`;

    // Pre-populate with a key that matches no provided session
    mockSessionStorage.setItem("cadence_open_windows", JSON.stringify([staleKey]));

    // Render with no matching sessions — stale key should be dropped.
    // Wrap in act to ensure all effects (including the persistence useEffect) flush.
    await act(async () => {
      render(
        <MemoryRouter><AgentManager sessions={[]} selectedProject={null} /></MemoryRouter>,
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

    const { getAllByTestId } = render(
      <MemoryRouter><AgentManager sessions={sessions} selectedProject={null} /></MemoryRouter>,
    );

    // The session button should have the minimized CSS class
    const sessionBtn = getAllByTestId("sidebar-session")[0];
    expect(sessionBtn.className).toContain("sidebarSessionMinimized");
  });
});
