// @vitest-environment jsdom

import { vi } from "vitest";

const { mockFetchAllSessions, mockUsePageVisibility } = vi.hoisted(() => ({
  mockFetchAllSessions: vi.fn(),
  mockUsePageVisibility: vi.fn(() => false),
}));

vi.mock("../api/agentHubClient", () => ({
  fetchAllSessions: mockFetchAllSessions,
}));

vi.mock("./usePageVisibility", () => ({
  usePageVisibility: () => mockUsePageVisibility(),
}));

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "../gen/hub/v1/hub_pb";
import { useAllSessions } from "./useAllSessions";
import type { Session } from "../types";
import type { AgentSessions } from "../api/agentHubClient";

const POLL_INTERVAL_MS = 10_000;

// Thin wrapper so we can swap out renderHook in one place if needed.
const renderHookTracked = renderHook;

function makeSession(overrides: Partial<{ id: string; name: string; state: string; agentProfile: string; waitingForInput: boolean }> = {}): Session {
  return create(SessionSchema, {
    id: overrides.id ?? "session-1",
    agentProfile: overrides.agentProfile ?? "default",
    name: overrides.name ?? "test-session",
    state: overrides.state ?? "running",
    waitingForInput: overrides.waitingForInput ?? false,
    createdAt: "2024-01-01T00:00:00Z",
  }) as unknown as Session;
}

function makeAgentSessions(
  agentName: string,
  sessions: Session[],
): AgentSessions {
  return { agentName, sessions };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  // vi.restoreAllMocks() does not clear Once-implementation queues on plain
  // vi.fn() instances; vi.resetAllMocks() does. Both are needed here.
  vi.resetAllMocks();
  mockUsePageVisibility.mockReturnValue(false);
  mockFetchAllSessions.mockResolvedValue([]);
});

afterEach(() => {
  // Clear all pending fake timers. This covers any intervals that were set
  // during the test and not yet cleared, preventing them from firing in the
  // next test's timer environment.
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAllSessions", () => {
  describe("initial state", () => {
    it("starts with loading: true", () => {
      mockFetchAllSessions.mockReturnValue(new Promise(() => {})); // never resolves
      const { result } = renderHookTracked(() => useAllSessions());
      expect(result.current.loading).toBe(true);
    });

    it("starts with empty sessions array", () => {
      mockFetchAllSessions.mockReturnValue(new Promise(() => {}));
      const { result } = renderHookTracked(() => useAllSessions());
      expect(result.current.sessions).toEqual([]);
    });

    it("starts with null error", () => {
      mockFetchAllSessions.mockReturnValue(new Promise(() => {}));
      const { result } = renderHookTracked(() => useAllSessions());
      expect(result.current.error).toBeNull();
    });
  });

  describe("after successful fetch", () => {
    it("sets loading: false after fetch completes", async () => {
      const session = makeSession();
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [session]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(result.current.loading).toBe(false);
    });

    it("populates sessions after fetch completes", async () => {
      const session = makeSession({ id: "s1", state: "running" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [session]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.sessions[0].session.id).toBe("s1");
      expect(result.current.sessions[0].agentName).toBe("agent-1");
    });

    it("clears error after a successful fetch", async () => {
      mockFetchAllSessions
        .mockRejectedValueOnce(new Error("initial failure"))
        .mockResolvedValueOnce([makeAgentSessions("agent-1", [makeSession()])]);

      const { result } = renderHookTracked(() => useAllSessions());

      // First fetch fails (initial fetch), sets error
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.error).toBe("Failed to fetch sessions");

      // Advance past the poll interval — second fetch succeeds, error clears
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(result.current.error).toBeNull();
      expect(result.current.sessions.length).toBe(1);
    });
  });

  describe("flattening multi-agent multi-session responses", () => {
    it("flattens sessions from multiple agents into a single array", async () => {
      const sessionA1 = makeSession({ id: "a1-s1" });
      const sessionA2 = makeSession({ id: "a1-s2" });
      const sessionB1 = makeSession({ id: "a2-s1" });

      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-alpha", [sessionA1, sessionA2]),
        makeAgentSessions("agent-beta", [sessionB1]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(result.current.sessions).toHaveLength(3);
    });

    it("tags each session with the correct agentName", async () => {
      const sessionA = makeSession({ id: "s-a" });
      const sessionB = makeSession({ id: "s-b" });

      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("alpha", [sessionA]),
        makeAgentSessions("beta", [sessionB]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      const alphaEntry = result.current.sessions.find(
        (s) => s.session.id === "s-a",
      );
      const betaEntry = result.current.sessions.find(
        (s) => s.session.id === "s-b",
      );
      expect(alphaEntry?.agentName).toBe("alpha");
      expect(betaEntry?.agentName).toBe("beta");
    });

    it("sets stateSource to 'A' for all fetched sessions", async () => {
      const session = makeSession({ id: "s1" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [session]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(result.current.sessions[0].stateSource).toBe("A");
    });

    it("returns empty sessions when all agents have empty session arrays", async () => {
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", []),
        makeAgentSessions("agent-2", []),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(result.current.sessions).toEqual([]);
    });
  });

  describe("waitingSessions", () => {
    it("filters only sessions with waitingForInput: true", async () => {
      const waiting = makeSession({ id: "w1", waitingForInput: true });
      const notWaiting = makeSession({ id: "n1", waitingForInput: false });

      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [waiting, notWaiting]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(result.current.waitingSessions).toHaveLength(1);
      expect(result.current.waitingSessions[0].session.id).toBe("w1");
    });

    it("returns empty array when no sessions are waiting", async () => {
      const session = makeSession({ waitingForInput: false });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [session]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(result.current.waitingSessions).toEqual([]);
    });

    it("includes all waiting sessions across multiple agents", async () => {
      const w1 = makeSession({ id: "w1", waitingForInput: true });
      const w2 = makeSession({ id: "w2", waitingForInput: true });
      const n1 = makeSession({ id: "n1", waitingForInput: false });

      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [w1, n1]),
        makeAgentSessions("agent-2", [w2]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(result.current.waitingSessions).toHaveLength(2);
    });
  });

  describe("polling", () => {
    it("calls fetchAllSessions again after the poll interval", async () => {
      mockFetchAllSessions.mockResolvedValue([]);

      renderHookTracked(() => useAllSessions());

      // Flush initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      const callsAfterInitial = mockFetchAllSessions.mock.calls.length;
      // At least one call happened (the initial fetch)
      expect(callsAfterInitial).toBeGreaterThanOrEqual(1);

      // Advance past one interval — should trigger exactly one more call
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      expect(mockFetchAllSessions.mock.calls.length).toBe(callsAfterInitial + 1);
    });

    it("continues polling multiple intervals", async () => {
      mockFetchAllSessions.mockResolvedValue([]);

      renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      });

      expect(mockFetchAllSessions.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it("clears interval on unmount and stops polling", async () => {
      mockFetchAllSessions.mockResolvedValue([]);

      const { unmount } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      const callsAtUnmount = mockFetchAllSessions.mock.calls.length;
      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      });

      expect(mockFetchAllSessions.mock.calls.length).toBe(callsAtUnmount);
    });

    it("updates sessions with fresh data on each poll", async () => {
      const sessionV1 = makeSession({ id: "s1", state: "running" });
      const sessionV2 = makeSession({ id: "s1", state: "stopped" });

      mockFetchAllSessions
        .mockResolvedValueOnce([makeAgentSessions("agent-1", [sessionV1])])
        .mockResolvedValueOnce([makeAgentSessions("agent-1", [sessionV2])]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.sessions[0].session.state).toBe("running");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      expect(result.current.sessions[0].session.state).toBe("stopped");
    });
  });

  describe("does NOT poll when page is hidden", () => {
    it("does not call fetchAllSessions when page is hidden from the start", async () => {
      mockUsePageVisibility.mockReturnValue(true);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      });

      expect(mockFetchAllSessions).not.toHaveBeenCalled();
      expect(result.current.loading).toBe(false);
    });

    it("stops polling when page becomes hidden", async () => {
      mockFetchAllSessions.mockResolvedValue([]);

      const { rerender } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(mockFetchAllSessions).toHaveBeenCalledTimes(1);

      // Page hides
      mockUsePageVisibility.mockReturnValue(true);
      await act(async () => {
        rerender();
      });

      const callsWhenHidden = mockFetchAllSessions.mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      });

      expect(mockFetchAllSessions.mock.calls.length).toBe(callsWhenHidden);
    });

    it("resumes polling when page becomes visible again", async () => {
      mockFetchAllSessions.mockResolvedValue([]);

      // Start hidden
      mockUsePageVisibility.mockReturnValue(true);
      const { rerender } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      expect(mockFetchAllSessions).not.toHaveBeenCalled();

      // Page becomes visible
      mockUsePageVisibility.mockReturnValue(false);
      await act(async () => {
        rerender();
      });

      // Initial poll fires immediately when visible
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(mockFetchAllSessions).toHaveBeenCalledTimes(1);
    });
  });

  describe("optimisticSetDestroying", () => {
    it("sets state to 'destroying' and stateSource to 'U' for the matching session", async () => {
      const session = makeSession({ id: "s1", state: "running" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [session]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      act(() => {
        result.current.optimisticSetDestroying("s1");
      });

      const updated = result.current.sessions.find(
        (s) => s.session.id === "s1",
      );
      expect(updated?.session.state).toBe("destroying");
      expect(updated?.stateSource).toBe("U");
    });

    it("does not modify other sessions", async () => {
      const s1 = makeSession({ id: "s1", state: "running" });
      const s2 = makeSession({ id: "s2", state: "running" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [s1, s2]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      act(() => {
        result.current.optimisticSetDestroying("s1");
      });

      const unmodified = result.current.sessions.find(
        (s) => s.session.id === "s2",
      );
      expect(unmodified?.session.state).toBe("running");
      expect(unmodified?.stateSource).toBe("A");
    });

    it("is a no-op when sessionId does not match any session", async () => {
      const session = makeSession({ id: "s1" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [session]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      const before = result.current.sessions;

      act(() => {
        result.current.optimisticSetDestroying("nonexistent");
      });

      expect(result.current.sessions).toEqual(before);
    });
  });

  describe("optimisticResetState", () => {
    it("updates state and sets stateSource to 'U' for the matching session", async () => {
      const session = makeSession({ id: "s1", state: "running" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [session]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      act(() => {
        result.current.optimisticResetState("s1", "stopped");
      });

      const updated = result.current.sessions.find(
        (s) => s.session.id === "s1",
      );
      expect(updated?.session.state).toBe("stopped");
      expect(updated?.stateSource).toBe("U");
    });

    it("can reset to any valid session state", async () => {
      const session = makeSession({ id: "s1", state: "destroying" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [session]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      act(() => {
        result.current.optimisticResetState("s1", "running");
      });

      expect(
        result.current.sessions.find((s) => s.session.id === "s1")?.session
          .state,
      ).toBe("running");
    });

    it("does not modify other sessions", async () => {
      const s1 = makeSession({ id: "s1", state: "running" });
      const s2 = makeSession({ id: "s2", state: "stopped" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [s1, s2]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      act(() => {
        result.current.optimisticResetState("s1", "error");
      });

      const unmodified = result.current.sessions.find(
        (s) => s.session.id === "s2",
      );
      expect(unmodified?.session.state).toBe("stopped");
    });

    it("is a no-op when sessionId does not match any session", async () => {
      const session = makeSession({ id: "s1", state: "running" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [session]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      const before = result.current.sessions;

      act(() => {
        result.current.optimisticResetState("nonexistent", "stopped");
      });

      expect(result.current.sessions).toEqual(before);
    });
  });

  describe("optimisticAddSession", () => {
    it("prepends a new session to the list", async () => {
      const existing = makeSession({ id: "existing" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [existing]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      const newSession = makeSession({ id: "new-s" });

      act(() => {
        result.current.optimisticAddSession(newSession, "agent-2");
      });

      expect(result.current.sessions[0].session.id).toBe("new-s");
      expect(result.current.sessions[0].agentName).toBe("agent-2");
      expect(result.current.sessions[0].stateSource).toBe("U");
      expect(result.current.sessions).toHaveLength(2);
    });

    it("is a no-op if the session id already exists", async () => {
      const existing = makeSession({ id: "s1", state: "running" });
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [existing]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      const duplicate = makeSession({ id: "s1", state: "stopped" });

      act(() => {
        result.current.optimisticAddSession(duplicate, "agent-1");
      });

      expect(result.current.sessions).toHaveLength(1);
      // Original state preserved
      expect(result.current.sessions[0].session.state).toBe("running");
    });

    it("works on an empty sessions list", async () => {
      mockFetchAllSessions.mockResolvedValue([]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      const newSession = makeSession({ id: "fresh" });

      act(() => {
        result.current.optimisticAddSession(newSession, "agent-1");
      });

      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.sessions[0].session.id).toBe("fresh");
    });

    it("subsequent no-op does not change the sessions reference when id already exists", async () => {
      mockFetchAllSessions.mockResolvedValue([]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      const session = makeSession({ id: "s1" });

      act(() => {
        result.current.optimisticAddSession(session, "agent-1");
      });

      const afterFirst = result.current.sessions;

      act(() => {
        result.current.optimisticAddSession(session, "agent-1");
      });

      // Same reference — no state update triggered
      expect(result.current.sessions).toBe(afterFirst);
    });
  });

  describe("error handling", () => {
    it("sets error on initial fetch failure", async () => {
      mockFetchAllSessions.mockRejectedValue(new Error("network error"));

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(result.current.error).toBe("Failed to fetch sessions");
      expect(result.current.loading).toBe(false);
    });

    it("does not set error on first or second polling failure (only after 3 consecutive)", async () => {
      // `isInitialFetch` is only false when the effect re-runs after a visibility
      // change. To test the failures >= 3 guard, we must:
      //   1. Mount and do the initial fetch (success) — hasFetchedRef.current = true
      //   2. Toggle visibility to cause the effect to re-run with isInitialFetch = false
      //   3. Then trigger consecutive polling failures and verify error stays null
      const session = makeSession({ id: "s1" });
      mockFetchAllSessions
        .mockResolvedValueOnce([makeAgentSessions("agent-1", [session])])
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"));

      const { result, rerender } = renderHookTracked(() => useAllSessions());

      // Initial fetch succeeds (isInitialFetch = true for this effect run)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.error).toBeNull();

      // Toggle visibility: page hides then shows → effect re-runs with isInitialFetch = false
      mockUsePageVisibility.mockReturnValue(true);
      await act(async () => { rerender(); });
      mockUsePageVisibility.mockReturnValue(false);
      await act(async () => { rerender(); });

      // New effect run: isInitialFetch = false, failures = 0
      // First polling failure (failures = 1 < 3) — no error
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1); // flush immediate poll on re-mount
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      expect(result.current.error).toBeNull();

      // Second polling failure (failures = 2 < 3) — still no error
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      expect(result.current.error).toBeNull();
    });

    it("sets error after 3 consecutive polling failures", async () => {
      const session = makeSession({ id: "s1" });
      mockFetchAllSessions
        .mockResolvedValueOnce([makeAgentSessions("agent-1", [session])])
        .mockRejectedValue(new Error("persistent failure"));

      const { result } = renderHookTracked(() => useAllSessions());

      // Initial fetch succeeds
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.error).toBeNull();

      // 3 polling failures
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      });

      expect(result.current.error).toBe("Failed to fetch sessions");
    });

    it("does not change loading to true for polling fetches (only initial)", async () => {
      const session = makeSession();
      mockFetchAllSessions.mockResolvedValue([
        makeAgentSessions("agent-1", [session]),
      ]);

      const { result } = renderHookTracked(() => useAllSessions());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.loading).toBe(false);

      // After initial fetch, loading should not flip back to true on subsequent polls
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      expect(result.current.loading).toBe(false);
    });
  });
});
