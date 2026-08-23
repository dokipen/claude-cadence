// @vitest-environment jsdom

import { vi } from "vitest";

const { mockFetchSession } = vi.hoisted(() => ({
  mockFetchSession: vi.fn(),
}));

vi.mock("../api/agentHubClient", () => ({
  fetchSession: mockFetchSession,
}));

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "../gen/hub/v1/hub_pb";
import { useSessionPromptContext } from "./useSessionPromptContext";
import type { Session } from "../types";

function makeSession(overrides: Partial<{ promptContext: string; promptType: string }> = {}): Session {
  return create(SessionSchema, {
    id: "sess-1",
    agentProfile: "default",
    name: "lead-42",
    state: "running",
    waitingForInput: true,
    createdAt: "2024-01-01T00:00:00Z",
    idleSince: "2024-01-01T00:01:00Z",
    ...overrides,
  }) as unknown as Session;
}

interface HookProps {
  agentName: string;
  sessionId: string;
  enabled: boolean;
  idleSince: string | undefined;
}

function renderPromptHook(initial: Partial<HookProps> = {}) {
  const initialProps: HookProps = {
    agentName: "mac",
    sessionId: "sess-1",
    enabled: true,
    idleSince: "2024-01-01T00:01:00Z",
    ...initial,
  };
  return renderHook(
    ({ agentName, sessionId, enabled, idleSince }: HookProps) =>
      useSessionPromptContext(agentName, sessionId, enabled, idleSince),
    { initialProps },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockFetchSession.mockResolvedValue(makeSession());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSessionPromptContext", () => {
  it("does not fetch when disabled and returns empty values", () => {
    const { result } = renderPromptHook({ enabled: false });
    expect(mockFetchSession).not.toHaveBeenCalled();
    expect(result.current).toEqual({
      promptContext: undefined,
      promptType: undefined,
      loading: false,
      error: null,
    });
  });

  it("fetches once when enabled and exposes promptContext/promptType", async () => {
    mockFetchSession.mockResolvedValue(
      makeSession({ promptContext: "? Continue (y/N)", promptType: "yesno" }),
    );
    const { result } = renderPromptHook();

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetchSession).toHaveBeenCalledTimes(1);
    expect(mockFetchSession).toHaveBeenCalledWith("mac", "sess-1");
    expect(result.current.promptContext).toBe("? Continue (y/N)");
    expect(result.current.promptType).toBe("yesno");
    expect(result.current.error).toBeNull();
  });

  it("does not refetch on rerender with unchanged inputs", async () => {
    const { result, rerender } = renderPromptHook();
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ agentName: "mac", sessionId: "sess-1", enabled: true, idleSince: "2024-01-01T00:01:00Z" });

    expect(mockFetchSession).toHaveBeenCalledTimes(1);
  });

  it("refetches when idleSince changes", async () => {
    mockFetchSession
      .mockResolvedValueOnce(makeSession({ promptContext: "first prompt", promptType: "yesno" }))
      .mockResolvedValueOnce(makeSession({ promptContext: "second prompt", promptType: "select" }));

    const { result, rerender } = renderPromptHook();
    await waitFor(() => expect(result.current.promptContext).toBe("first prompt"));

    rerender({ agentName: "mac", sessionId: "sess-1", enabled: true, idleSince: "2024-01-01T00:05:00Z" });

    // A new prompt invalidates the old one: loading again with stale values cleared.
    expect(result.current.loading).toBe(true);
    expect(result.current.promptContext).toBeUndefined();

    await waitFor(() => expect(result.current.promptContext).toBe("second prompt"));
    expect(result.current.promptType).toBe("select");
    expect(mockFetchSession).toHaveBeenCalledTimes(2);
  });

  it("clears values and does not fetch again when disabled after being enabled", async () => {
    mockFetchSession.mockResolvedValue(makeSession({ promptContext: "ctx", promptType: "yesno" }));
    const { result, rerender } = renderPromptHook();
    await waitFor(() => expect(result.current.promptContext).toBe("ctx"));

    rerender({ agentName: "mac", sessionId: "sess-1", enabled: false, idleSince: undefined });

    expect(result.current).toEqual({
      promptContext: undefined,
      promptType: undefined,
      loading: false,
      error: null,
    });
    expect(mockFetchSession).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale result when inputs change before it resolves", async () => {
    let resolveFirst: (s: Session) => void = () => {};
    mockFetchSession
      .mockImplementationOnce(
        () => new Promise<Session>((resolve) => { resolveFirst = resolve; }),
      )
      .mockResolvedValueOnce(makeSession({ promptContext: "fresh", promptType: "text" }));

    const { result, rerender } = renderPromptHook();
    expect(result.current.loading).toBe(true);

    rerender({ agentName: "mac", sessionId: "sess-1", enabled: true, idleSince: "2024-01-01T00:09:00Z" });
    await waitFor(() => expect(result.current.promptContext).toBe("fresh"));

    // The first (stale) request resolves late and must not overwrite the fresh result.
    await act(async () => {
      resolveFirst(makeSession({ promptContext: "stale", promptType: "yesno" }));
    });
    expect(result.current.promptContext).toBe("fresh");
    expect(result.current.promptType).toBe("text");
  });

  it("does not update state when unmounted before the fetch resolves", async () => {
    let resolveFetch: (s: Session) => void = () => {};
    mockFetchSession.mockImplementation(
      () => new Promise<Session>((resolve) => { resolveFetch = resolve; }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result, unmount } = renderPromptHook();
    expect(result.current.loading).toBe(true);

    unmount();

    await act(async () => {
      resolveFetch(makeSession({ promptContext: "late", promptType: "yesno" }));
    });

    expect(consoleError).not.toHaveBeenCalled();
    // Snapshot is frozen at unmount: the late result was ignored.
    expect(result.current.loading).toBe(true);
    expect(result.current.promptContext).toBeUndefined();
  });

  it("sets error and leaves promptContext undefined when the fetch rejects", async () => {
    mockFetchSession.mockRejectedValue(new Error("boom"));
    const { result } = renderPromptHook();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("boom");
    expect(result.current.promptContext).toBeUndefined();
    expect(result.current.promptType).toBeUndefined();
  });

  it("uses a fallback message for non-Error rejections", async () => {
    mockFetchSession.mockRejectedValue("nope");
    const { result } = renderPromptHook();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to load prompt");
  });
});
