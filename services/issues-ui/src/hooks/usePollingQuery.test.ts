// @vitest-environment jsdom

// vi.mock calls must appear before imports — Vitest hoists them
const mockRequest = vi.fn();
vi.mock("../api/client", () => ({
  getClient: () => ({ request: mockRequest }),
}));

const mockLogout = vi.fn();
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ logout: mockLogout }),
}));

const mockUsePageVisibility = vi.fn(() => false);
vi.mock("./usePageVisibility", () => ({
  usePageVisibility: () => mockUsePageVisibility(),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePollingQuery } from "./usePollingQuery";

// ---------------------------------------------------------------------------
// Shared test data factories
// ---------------------------------------------------------------------------

interface ItemResponse {
  items: { id: string }[];
}

interface ItemData {
  items: { id: string }[];
}

const QUERY = "query GetItems { items { id } }";
const ERROR_MESSAGE = "Failed to load items";
const INTERVAL_MS = 1000;

function makeResponse(ids: string[]): ItemResponse {
  return { items: ids.map((id) => ({ id })) };
}

function makeTransform(response: ItemResponse): ItemData {
  return { items: response.items };
}

const INITIAL_DATA: ItemData = { items: [] };
const VARIABLES = { projectId: "proj-1" };

function makeHookOptions(overrides: Partial<Parameters<typeof usePollingQuery>[0]> = {}) {
  return {
    query: QUERY,
    variables: VARIABLES as Record<string, unknown> | null,
    transform: makeTransform as (r: unknown) => ItemData,
    initialData: INITIAL_DATA,
    errorMessage: ERROR_MESSAGE,
    intervalMs: INTERVAL_MS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  mockRequest.mockReset();
  mockLogout.mockReset();
  mockUsePageVisibility.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePollingQuery — initial state", () => {
  it("returns { loading: true } before the first fetch resolves", () => {
    // Never resolving promise simulates an in-flight request
    mockRequest.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePollingQuery(makeHookOptions()));

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(INITIAL_DATA);
  });
});

describe("usePollingQuery — successful initial fetch", () => {
  it("returns transformed data and clears loading after the first fetch resolves", async () => {
    mockRequest.mockResolvedValueOnce(makeResponse(["a", "b"]));

    const { result } = renderHook(() => usePollingQuery(makeHookOptions()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ items: [{ id: "a" }, { id: "b" }] });
  });
});

describe("usePollingQuery — null variables", () => {
  it("skips fetch and returns { loading: false, data: null } when variables is null", async () => {
    const { result } = renderHook(() =>
      usePollingQuery(
        makeHookOptions({ variables: null, initialData: null as unknown as ItemData }),
      ),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockRequest).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });
});

describe("usePollingQuery — initial fetch failure", () => {
  it("sets error string immediately on initial fetch failure", async () => {
    mockRequest.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => usePollingQuery(makeHookOptions()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toBe(ERROR_MESSAGE);
    expect(result.current.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Note on suppression scope: `isInitialFetch` is captured once per effect
// invocation from `hasFetchedRef.current`. Suppression only applies when a
// NEW effect run begins after the first fetch has already completed (i.e.,
// `hasFetchedRef.current === true`). This happens when a dependency such as
// `variables` changes after the initial successful fetch. Within the new
// effect run, consecutive poll failures (with `isInitialFetch === false`) are
// suppressed for the first 2 and exposed on the 3rd.
// ---------------------------------------------------------------------------
describe("usePollingQuery — subsequent poll failure suppression", () => {
  it("suppresses error for the first consecutive subsequent poll failure (new effect run)", async () => {
    // First effect run: initial fetch succeeds, sets hasFetchedRef.current = true.
    // Second effect run (after variables change): isInitialFetch = false.
    // First failure in second run → suppressed.
    mockRequest
      .mockResolvedValueOnce(makeResponse(["a"]))  // initial fetch
      .mockRejectedValueOnce(new Error("oops"));   // first poll in new effect run

    let variables: Record<string, unknown> = { projectId: "proj-1" };
    const { result, rerender } = renderHook(() =>
      usePollingQuery(makeHookOptions({ variables })),
    );

    // Let initial fetch complete
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBeNull();

    // Change variables to trigger a new effect run where isInitialFetch = false
    variables = { projectId: "proj-2" };
    await act(async () => {
      rerender();
    });

    // First poll of new effect run fails — should be suppressed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toBeNull();
  });

  it("suppresses error for the second consecutive subsequent poll failure (new effect run)", async () => {
    // After variables change (new effect, isInitialFetch=false):
    //   failure #1: immediate fetchData() call on effect start
    //   failure #2: first setInterval tick
    //   Both are below the threshold of 3 → suppressed.
    mockRequest
      .mockResolvedValueOnce(makeResponse(["a"]))  // initial fetch
      .mockRejectedValue(new Error("oops"));        // all subsequent polls fail

    let variables: Record<string, unknown> = { projectId: "proj-1" };
    const { result, rerender } = renderHook(() =>
      usePollingQuery(makeHookOptions({ variables })),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBeNull();

    // Trigger new effect run with isInitialFetch = false
    variables = { projectId: "proj-2" };
    await act(async () => {
      rerender();
    });

    // Resolve immediate call (failure #1) + advance one interval (failure #2) = 2 failures
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    });

    expect(result.current.error).toBeNull();
  });

  it("sets error on the 3rd consecutive subsequent poll failure (new effect run)", async () => {
    // After variables change (new effect, isInitialFetch=false):
    //   failure #1: immediate fetchData() call
    //   failure #2: first interval tick
    //   failure #3: second interval tick → error exposed
    mockRequest
      .mockResolvedValueOnce(makeResponse(["a"]))  // initial fetch
      .mockRejectedValue(new Error("oops"));        // all subsequent polls fail

    let variables: Record<string, unknown> = { projectId: "proj-1" };
    const { result, rerender } = renderHook(() =>
      usePollingQuery(makeHookOptions({ variables })),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBeNull();

    // Trigger new effect run with isInitialFetch = false
    variables = { projectId: "proj-2" };
    await act(async () => {
      rerender();
    });

    // Immediate call (failure #1) + 2 interval ticks (failures #2 and #3) = 3 total
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    });

    expect(result.current.error).toBe(ERROR_MESSAGE);
  });
});

describe("usePollingQuery — error recovery after poll failure", () => {
  it("clears error when a subsequent poll succeeds after failures", async () => {
    // Initial fetch succeeds. Variables change → new effect run (isInitialFetch = false).
    // 3 failures expose the error. Then a success clears it.
    mockRequest
      .mockResolvedValueOnce(makeResponse(["a"]))  // initial fetch
      .mockRejectedValueOnce(new Error("fail 1"))  // poll 1
      .mockRejectedValueOnce(new Error("fail 2"))  // poll 2
      .mockRejectedValueOnce(new Error("fail 3"))  // poll 3 — error exposed
      .mockResolvedValueOnce(makeResponse(["b"])); // poll 4 — recovery

    let variables: Record<string, unknown> = { projectId: "proj-1" };
    const { result, rerender } = renderHook(() =>
      usePollingQuery(makeHookOptions({ variables })),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBeNull();

    // Trigger new effect run with isInitialFetch = false
    variables = { projectId: "proj-2" };
    await act(async () => {
      rerender();
    });

    // Immediate call (failure #1) + 2 interval ticks (failures #2 and #3) = error exposed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    });
    expect(result.current.error).toBe(ERROR_MESSAGE);

    // 4th call (3rd interval tick) succeeds — error cleared, new data set
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ items: [{ id: "b" }] });
  });
});

describe("usePollingQuery — polling interval", () => {
  it("calls fetch again after the specified interval elapses", async () => {
    mockRequest.mockResolvedValue(makeResponse(["x"]));

    renderHook(() => usePollingQuery(makeHookOptions()));

    // Initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);

    // One interval passes — second fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);

    // Two more intervals — four total
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    });
    expect(mockRequest).toHaveBeenCalledTimes(4);
  });
});

describe("usePollingQuery — page visibility: hidden", () => {
  it("does NOT fetch on mount and does NOT poll when usePageVisibility returns true", async () => {
    mockUsePageVisibility.mockReturnValue(true);
    mockRequest.mockResolvedValue(makeResponse(["x"]));

    renderHook(() => usePollingQuery(makeHookOptions()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    });

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("returns loading: false without fetching when page is hidden on mount", async () => {
    mockUsePageVisibility.mockReturnValue(true);

    const { result } = renderHook(() => usePollingQuery(makeHookOptions()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe("usePollingQuery — page visibility: resumes on visible", () => {
  it("resumes fetching when page becomes visible after being hidden", async () => {
    mockRequest.mockResolvedValue(makeResponse(["x"]));

    // Start visible, fetch on mount
    const { rerender } = renderHook(() => usePollingQuery(makeHookOptions()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);

    // Page hides — no more fetches
    mockUsePageVisibility.mockReturnValue(true);
    await act(async () => {
      rerender();
    });

    const callsBeforeHidden = mockRequest.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    });
    expect(mockRequest.mock.calls.length).toBe(callsBeforeHidden);

    // Page becomes visible again — fetches resume
    mockUsePageVisibility.mockReturnValue(false);
    await act(async () => {
      rerender();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    });
    expect(mockRequest.mock.calls.length).toBeGreaterThan(callsBeforeHidden);
  });
});

describe("usePollingQuery — cleanup on unmount", () => {
  it("clears the polling interval on unmount and makes no further requests", async () => {
    mockRequest.mockResolvedValue(makeResponse(["x"]));

    const { unmount } = renderHook(() => usePollingQuery(makeHookOptions()));

    // Initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAtUnmount = mockRequest.mock.calls.length;

    unmount();

    // Several intervals pass — no additional calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
    });

    expect(mockRequest.mock.calls.length).toBe(callsAtUnmount);
  });
});
