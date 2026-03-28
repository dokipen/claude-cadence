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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLabels } from "./useLabels";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLabels — initial state", () => {
  it("returns { loading: true } before the fetch resolves", () => {
    // Never resolving promise simulates an in-flight request
    mockRequest.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useLabels());

    expect(result.current.loading).toBe(true);
    expect(result.current.labels).toEqual([]);
  });
});

describe("useLabels — successful fetch", () => {
  it("returns labels array and sets loading: false after fetch resolves", async () => {
    const fakeLabels = [
      { id: "1", name: "bug", color: "red" },
      { id: "2", name: "feature", color: "blue" },
    ];
    mockRequest.mockResolvedValueOnce({ labels: fakeLabels });

    const { result } = renderHook(() => useLabels());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.labels).toEqual(fakeLabels);
  });
});

describe("useLabels — fetch failure", () => {
  it("silently swallows errors: loading: false, labels stays empty, no error exposed", async () => {
    mockRequest.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useLabels());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.labels).toEqual([]);
    // Hook exposes no error field — only labels + loading
    expect((result.current as Record<string, unknown>).error).toBeUndefined();
  });
});

describe("useLabels — unmount cancellation", () => {
  it("does not update state after unmount", async () => {
    let resolveRequest!: (value: { labels: { id: string; name: string; color: string }[] }) => void;
    const pendingPromise = new Promise<{ labels: { id: string; name: string; color: string }[] }>(
      (resolve) => {
        resolveRequest = resolve;
      },
    );
    mockRequest.mockReturnValueOnce(pendingPromise);

    const { result, unmount } = renderHook(() => useLabels());

    expect(result.current.loading).toBe(true);

    // Unmount before the fetch resolves — cancellation guard should prevent state update
    unmount();

    // Now resolve the promise; if the guard works, React won't warn about
    // state updates on unmounted components and loading stays true in the
    // captured snapshot
    await act(async () => {
      resolveRequest({ labels: [{ id: "1", name: "bug", color: "red" }] });
      await vi.advanceTimersByTimeAsync(0);
    });

    // The result snapshot captured before unmount should be unchanged
    expect(result.current.loading).toBe(true);
    expect(result.current.labels).toEqual([]);
  });
});
