// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "./useIsMobile";

// Helper to create a mock MediaQueryList
function makeMockMql(matches: boolean): MediaQueryList & { _trigger: (matches: boolean) => void } {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mql = {
    matches,
    media: "(max-width: 768px)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
      if (event === "change") listeners.push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
      if (event === "change") {
        const idx = listeners.indexOf(handler);
        if (idx !== -1) listeners.splice(idx, 1);
      }
    }),
    dispatchEvent: vi.fn(),
    _trigger: (newMatches: boolean) => {
      mql.matches = newMatches;
      const event = { matches: newMatches } as MediaQueryListEvent;
      listeners.forEach((l) => l(event));
    },
  };
  return mql as unknown as MediaQueryList & { _trigger: (matches: boolean) => void };
}

describe("useIsMobile", () => {
  let mockMql: ReturnType<typeof makeMockMql>;

  beforeEach(() => {
    mockMql = makeMockMql(false);
    vi.stubGlobal("matchMedia", vi.fn(() => mockMql));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when viewport is wider than 768px", () => {
    mockMql = makeMockMql(false);
    vi.stubGlobal("matchMedia", vi.fn(() => mockMql));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("returns true when viewport is 768px or narrower", () => {
    mockMql = makeMockMql(true);
    vi.stubGlobal("matchMedia", vi.fn(() => mockMql));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("updates to true when viewport narrows below 768px", () => {
    mockMql = makeMockMql(false);
    vi.stubGlobal("matchMedia", vi.fn(() => mockMql));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      mockMql._trigger(true);
    });

    expect(result.current).toBe(true);
  });

  it("updates to false when viewport widens above 768px", () => {
    mockMql = makeMockMql(true);
    vi.stubGlobal("matchMedia", vi.fn(() => mockMql));

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);

    act(() => {
      mockMql._trigger(false);
    });

    expect(result.current).toBe(false);
  });

  it("removes the change event listener on unmount", () => {
    const { unmount } = renderHook(() => useIsMobile());
    unmount();
    expect(mockMql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
