// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePageVisibility } from "./usePageVisibility";

describe("usePageVisibility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when document.hidden is false", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);

    const { result } = renderHook(() => usePageVisibility());

    expect(result.current).toBe(false);
  });

  it("returns true when document.hidden is true", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    const { result } = renderHook(() => usePageVisibility());

    expect(result.current).toBe(true);
  });

  it("updates to true when visibilitychange fires and document.hidden becomes true", () => {
    const hiddenSpy = vi.spyOn(document, "hidden", "get").mockReturnValue(false);

    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(false);

    hiddenSpy.mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe(true);
  });

  it("updates to false when visibilitychange fires and document.hidden becomes false", () => {
    const hiddenSpy = vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(true);

    hiddenSpy.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe(false);
  });

  it("removes the visibilitychange event listener on unmount", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const removeListenerSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() => usePageVisibility());

    unmount();

    expect(removeListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });
});
