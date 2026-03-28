// @vitest-environment jsdom

// vi.mock calls must appear before imports — Vitest hoists them
const mockFetchDocFiles = vi.fn();
const mockFetchDocContent = vi.fn();
vi.mock("../api/docsClient", () => ({
  fetchDocFiles: (...args: unknown[]) => mockFetchDocFiles(...args),
  fetchDocContent: (...args: unknown[]) => mockFetchDocContent(...args),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDocFiles, useDocContent } from "./useDocs";

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
// useDocFiles tests
// ---------------------------------------------------------------------------

describe("useDocFiles — initial state", () => {
  it("returns { loading: true } before the fetch resolves", () => {
    mockFetchDocFiles.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDocFiles());

    expect(result.current.loading).toBe(true);
    expect(result.current.files).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

describe("useDocFiles — successful fetch", () => {
  it("populates files array and sets loading: false after fetch resolves", async () => {
    const fakeFiles = [
      { path: "docs/intro.md", name: "intro.md" },
      { path: "docs/guide.md", name: "guide.md" },
    ];
    mockFetchDocFiles.mockResolvedValueOnce(fakeFiles);

    const { result } = renderHook(() => useDocFiles());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.files).toEqual(fakeFiles);
    expect(result.current.error).toBeNull();
  });
});

describe("useDocFiles — fetch failure", () => {
  it("sets error and clears loading after fetch rejects", async () => {
    mockFetchDocFiles.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useDocFiles());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.files).toEqual([]);
    expect(result.current.error).toBe("Failed to fetch documents");
  });
});

// ---------------------------------------------------------------------------
// useDocContent tests
// ---------------------------------------------------------------------------

describe("useDocContent — null path", () => {
  it("returns { content: null, loading: false } without fetching when path is null", async () => {
    const { result } = renderHook(() => useDocContent(null));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.content).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockFetchDocContent).not.toHaveBeenCalled();
  });
});

describe("useDocContent — path provided", () => {
  it("fetches and populates content when path is given", async () => {
    mockFetchDocContent.mockResolvedValueOnce("# Hello World");

    const { result } = renderHook(() => useDocContent("docs/intro.md"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.content).toBe("# Hello World");
    expect(result.current.error).toBeNull();
    expect(mockFetchDocContent).toHaveBeenCalledWith("docs/intro.md");
  });
});

describe("useDocContent — path change", () => {
  it("re-fetches and resets content to null mid-flight when path changes", async () => {
    // First fetch resolves immediately
    mockFetchDocContent.mockResolvedValueOnce("# Page One");
    // Second fetch: we'll control resolution manually
    let resolveSecond!: (value: string) => void;
    const secondFetch = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
    mockFetchDocContent.mockReturnValueOnce(secondFetch);

    let path = "docs/page-one.md";
    const { result, rerender } = renderHook(() => useDocContent(path));

    // Resolve first fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.content).toBe("# Page One");

    // Change path — content should reset to null while second fetch is in-flight
    path = "docs/page-two.md";
    await act(async () => {
      rerender();
    });

    expect(result.current.content).toBeNull();
    expect(result.current.loading).toBe(true);

    // Resolve second fetch
    await act(async () => {
      resolveSecond("# Page Two");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.content).toBe("# Page Two");
    expect(result.current.loading).toBe(false);
    expect(mockFetchDocContent).toHaveBeenCalledWith("docs/page-two.md");
  });
});

describe("useDocContent — fetch failure", () => {
  it("sets error and clears loading after fetch rejects", async () => {
    mockFetchDocContent.mockRejectedValueOnce(new Error("not found"));

    const { result } = renderHook(() => useDocContent("docs/missing.md"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.content).toBeNull();
    expect(result.current.error).toBe("Failed to fetch document content");
  });
});
