// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import React from "react";
import type { ActiveSessionInfo } from "../types";

// Mock CSS modules
vi.mock("../styles/session-output-tooltip.module.css", () => ({ default: {} }));

const mockFetchSessionOutput = vi.fn();
vi.mock("../api/agentHubClient", () => ({
  fetchSessionOutput: (...args: unknown[]) => mockFetchSessionOutput(...args),
}));

import { SessionOutputTooltip } from "./SessionOutputTooltip";

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  mockFetchSessionOutput.mockReset();
});

const makeSession = (overrides: Partial<ActiveSessionInfo> = {}): ActiveSessionInfo => ({
  name: "lead-5",
  state: "running",
  sessionId: "session-abc",
  agentName: "my-agent",
  ...overrides,
});

describe("SessionOutputTooltip", () => {
  it("does not show tooltip before hover", () => {
    const session = makeSession();
    mockFetchSessionOutput.mockResolvedValue("some output");
    const { queryByTestId } = render(
      <SessionOutputTooltip session={session}>
        <span data-testid="icon">icon</span>
      </SessionOutputTooltip>,
    );
    expect(queryByTestId("session-output-tooltip")).toBeNull();
  });

  it("shows tooltip on mouseenter", async () => {
    const session = makeSession();
    mockFetchSessionOutput.mockResolvedValue("some output");
    const { getByTestId, container } = render(
      <SessionOutputTooltip session={session}>
        <span data-testid="icon">icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    expect(getByTestId("session-output-tooltip")).toBeTruthy();
  });

  it("shows Loading... before first fetch resolves", async () => {
    const session = makeSession();
    // Never resolves during this test
    mockFetchSessionOutput.mockReturnValue(new Promise(() => {}));
    const { getByTestId, container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    expect(getByTestId("session-output-content").textContent).toBe("Loading...");
  });

  it("shows fetched output after successful fetch", async () => {
    const session = makeSession();
    mockFetchSessionOutput.mockResolvedValue("line1\nline2");
    const { getByTestId, container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getByTestId("session-output-content").textContent).toBe("line1\nline2");
  });

  it("shows 'Output unavailable' when fetch fails", async () => {
    const session = makeSession();
    mockFetchSessionOutput.mockRejectedValue(new Error("network error"));
    const { getByTestId, container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getByTestId("session-output-content").textContent).toBe("Output unavailable");
  });

  it("hides tooltip on mouseleave", async () => {
    const session = makeSession();
    mockFetchSessionOutput.mockResolvedValue("output");
    const { queryByTestId, container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => {
      fireEvent.mouseLeave(container.firstChild as Element);
    });
    expect(queryByTestId("session-output-tooltip")).toBeNull();
  });

  it("polls every 2 seconds while visible and running", async () => {
    const session = makeSession({ state: "running" });
    mockFetchSessionOutput.mockResolvedValue("output");
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => { await Promise.resolve(); });
    const callsAfterFirstFetch = mockFetchSessionOutput.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(mockFetchSessionOutput.mock.calls.length).toBeGreaterThan(callsAfterFirstFetch);
  });

  it("does not poll when session state is stopped", async () => {
    const session = makeSession({ state: "stopped" });
    mockFetchSessionOutput.mockResolvedValue("output");
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => { await Promise.resolve(); });
    const callsAfterFirstFetch = mockFetchSessionOutput.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    expect(mockFetchSessionOutput.mock.calls.length).toBe(callsAfterFirstFetch);
  });

  it("stops polling on mouseleave", async () => {
    const session = makeSession({ state: "running" });
    mockFetchSessionOutput.mockResolvedValue("output");
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      fireEvent.mouseLeave(container.firstChild as Element);
    });
    const callsAfterLeave = mockFetchSessionOutput.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(6000);
      await Promise.resolve();
    });
    expect(mockFetchSessionOutput.mock.calls.length).toBe(callsAfterLeave);
  });

  it("does not fetch when sessionId is missing", async () => {
    const session = makeSession({ sessionId: undefined });
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => { await Promise.resolve(); });
    expect(mockFetchSessionOutput).not.toHaveBeenCalled();
  });

  it("does not fetch when agentName is missing", async () => {
    const session = makeSession({ agentName: undefined });
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => { await Promise.resolve(); });
    expect(mockFetchSessionOutput).not.toHaveBeenCalled();
  });

  it("truncates output to lines that fit the available viewport height", async () => {
    const session = makeSession({ state: "stopped" });
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    mockFetchSessionOutput.mockResolvedValue(lines.join("\n"));

    const { getByTestId, container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );

    // Position the wrapper near the bottom of the viewport so only 4 lines fit.
    // availableHeight = window.innerHeight - (bottom + 4) - 8
    // With bottom = window.innerHeight - 100: availableHeight = 88
    // maxLines = floor((88 - 16) / 15.4) = floor(72 / 15.4) = 4
    const wrapper = container.firstChild as HTMLElement;
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
      bottom: window.innerHeight - 100,
      top: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });

    await act(async () => {
      fireEvent.mouseEnter(wrapper);
    });
    await act(async () => { await Promise.resolve(); });

    const content = getByTestId("session-output-content").textContent ?? "";
    const renderedLines = content.split("\n");
    expect(renderedLines.length).toBe(4);
    expect(renderedLines[renderedLines.length - 1]).toBe("line10");
    // Verify early lines are excluded (line1–line6 should not appear)
    for (const excluded of ["line1", "line2", "line3", "line4", "line5", "line6"]) {
      expect(renderedLines).not.toContain(excluded);
    }
  });
});
