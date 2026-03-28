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
import { useProjects } from "./useProjects";
import type { Project } from "../types";

// ---------------------------------------------------------------------------
// Shared test data factories
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 60_000;

function makeProjects(ids: string[]): Project[] {
  return ids.map((id) => ({
    id,
    name: `Project ${id}`,
  }));
}

function makeResponse(ids: string[]): { projects: Project[] } {
  return { projects: makeProjects(ids) };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  mockUsePageVisibility.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useProjects — initial state", () => {
  it("returns { loading: true } before the first fetch resolves", () => {
    // Never-resolving promise simulates an in-flight request
    mockRequest.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useProjects());

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.projects).toEqual([]);
  });
});

describe("useProjects — successful initial fetch", () => {
  it("populates projects and clears loading after the first fetch resolves", async () => {
    mockRequest.mockResolvedValueOnce(makeResponse(["p1", "p2"]));

    const { result } = renderHook(() => useProjects());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.projects).toHaveLength(2);
    expect(result.current.projects[0].id).toBe("p1");
    expect(result.current.projects[1].id).toBe("p2");
  });
});

describe("useProjects — fetch failure", () => {
  it("sets error string and clears loading when fetch throws an Error", async () => {
    mockRequest.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useProjects());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("network error");
    expect(result.current.projects).toEqual([]);
  });

  it("uses fallback error message when thrown value is not an Error instance", async () => {
    mockRequest.mockRejectedValueOnce("something went wrong");

    const { result } = renderHook(() => useProjects());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toBe("Failed to load projects");
    expect(result.current.loading).toBe(false);
  });
});

describe("useProjects — page visibility: hidden", () => {
  it("does NOT fetch and returns loading: false when page is hidden on mount", async () => {
    mockUsePageVisibility.mockReturnValue(true);

    const { result } = renderHook(() => useProjects());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockRequest).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does NOT poll when page remains hidden", async () => {
    mockUsePageVisibility.mockReturnValue(true);
    mockRequest.mockResolvedValue(makeResponse(["p1"]));

    renderHook(() => useProjects());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });

    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe("useProjects — polling interval", () => {
  it("calls fetch again after 60 seconds elapse", async () => {
    mockRequest.mockResolvedValue(makeResponse(["p1"]));

    renderHook(() => useProjects());

    // Initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);

    // One interval passes — second fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);

    // Two more intervals — four total
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });
    expect(mockRequest).toHaveBeenCalledTimes(4);
  });
});

describe("useProjects — cleanup on unmount", () => {
  it("clears the polling interval on unmount and makes no further requests", async () => {
    mockRequest.mockResolvedValue(makeResponse(["p1"]));

    const { unmount } = renderHook(() => useProjects());

    // Initial fetch completes
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAtUnmount = mockRequest.mock.calls.length;

    unmount();

    // Several intervals pass — no additional calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    });

    expect(mockRequest.mock.calls.length).toBe(callsAtUnmount);
  });
});
