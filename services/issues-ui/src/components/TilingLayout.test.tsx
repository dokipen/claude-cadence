// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "../gen/hub/v1/hub_pb";
import { makeSessionStorageMock } from '../test-utils/makeSessionStorageMock';

// Mock TerminalWindow to avoid xterm and other heavy deps.
// Renders a div with data-testid="terminal-window-{key}" and a button that
// calls onMaximize so tests can trigger maximize/restore behavior.
vi.mock("./TerminalWindow", () => ({
  TerminalWindow: ({
    session,
    onMaximize,
    isMaximized,
  }: {
    session: { id: string };
    onMaximize?: () => void;
    isMaximized?: boolean;
  }) => (
    <div data-testid={`terminal-window-${session.id}`}>
      <button
        data-testid={`maximize-btn-${session.id}`}
        title={isMaximized ? "Restore" : "Maximize"}
        onClick={() => onMaximize?.()}
      />
    </div>
  ),
}));

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

import { TilingLayout } from "./TilingLayout";

const makeSession = (id: string) =>
  create(SessionSchema, {
    id,
    name: `session-${id}`,
    state: "running",
    agentProfile: "default",
    createdAt: "2026-01-01T00:00:00Z",
    agentPid: 1234,
    baseRef: "main",
    waitingForInput: false,
  });

const makeWindows = (ids: string[]) =>
  ids.map((id) => ({ key: id, session: makeSession(id), agentName: "agent-1" }));

afterEach(() => {
  cleanup();
});

describe("TilingLayout", () => {
  it("renders all windows when no window is maximized", () => {
    render(
      <TilingLayout
        windows={makeWindows(["a", "b", "c"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    expect(screen.getByTestId("terminal-window-a")).toBeDefined();
    expect(screen.getByTestId("terminal-window-b")).toBeDefined();
    expect(screen.getByTestId("terminal-window-c")).toBeDefined();
  });

  it("shows only the maximized window when a window is maximized", () => {
    render(
      <TilingLayout
        windows={makeWindows(["a", "b"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    // Maximize window "a"
    fireEvent.click(screen.getByTestId("maximize-btn-a"));

    expect(screen.getByTestId("terminal-window-a")).toBeDefined();
    expect(screen.queryByTestId("terminal-window-b")).toBeNull();
  });

  it("restores all windows when ESC is pressed while a window is maximized", () => {
    render(
      <TilingLayout
        windows={makeWindows(["a", "b"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    // Maximize window "a"
    fireEvent.click(screen.getByTestId("maximize-btn-a"));
    expect(screen.queryByTestId("terminal-window-b")).toBeNull();

    // Press ESC to restore
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByTestId("terminal-window-a")).toBeDefined();
    expect(screen.getByTestId("terminal-window-b")).toBeDefined();
  });

  it("restores all windows when the maximize button is clicked again on an already-maximized window", () => {
    render(
      <TilingLayout
        windows={makeWindows(["a", "b"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    // Maximize window "a"
    fireEvent.click(screen.getByTestId("maximize-btn-a"));
    expect(screen.queryByTestId("terminal-window-b")).toBeNull();

    // Click maximize again on "a" — should toggle off
    fireEvent.click(screen.getByTestId("maximize-btn-a"));

    expect(screen.getByTestId("terminal-window-a")).toBeDefined();
    expect(screen.getByTestId("terminal-window-b")).toBeDefined();
  });

  it("clears maximized state when the maximized window is removed from windows", () => {
    const { rerender } = render(
      <TilingLayout
        windows={makeWindows(["a", "b"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    // Maximize window "a"
    fireEvent.click(screen.getByTestId("maximize-btn-a"));
    expect(screen.queryByTestId("terminal-window-b")).toBeNull();

    // Remove window "a" (simulates termination)
    act(() => {
      rerender(
        <TilingLayout
          windows={makeWindows(["b"])}
          onMinimize={vi.fn()}
          onTerminated={vi.fn()}
        />,
      );
    });

    // Window "b" should now be visible (maximize state cleared)
    expect(screen.getByTestId("terminal-window-b")).toBeDefined();
  });
});

describe("TilingLayout — master-stack structure", () => {
  it("renders no split container for a single window", () => {
    render(
      <TilingLayout
        windows={makeWindows(["a"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    expect(screen.queryAllByTestId("tile-split")).toHaveLength(0);
    expect(screen.getByTestId("terminal-window-a")).toBeDefined();
  });

  it("renders a single horizontal split for 2 windows", () => {
    render(
      <TilingLayout
        windows={makeWindows(["a", "b"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    const splits = screen.getAllByTestId("tile-split");
    // Exactly one split: master (left) vs. single stack window (right)
    expect(splits).toHaveLength(1);

    // The root split should contain both terminal windows
    expect(screen.getByTestId("terminal-window-a")).toBeDefined();
    expect(screen.getByTestId("terminal-window-b")).toBeDefined();
  });

  it("renders master-stack layout for 3 windows: 1 horizontal root, 1 vertical stack split", () => {
    render(
      <TilingLayout
        windows={makeWindows(["a", "b", "c"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    // 3 windows → root horizontal split + 1 vertical split inside the stack column
    const splits = screen.getAllByTestId("tile-split");
    expect(splits).toHaveLength(2);

    // All three windows are rendered
    expect(screen.getByTestId("terminal-window-a")).toBeDefined();
    expect(screen.getByTestId("terminal-window-b")).toBeDefined();
    expect(screen.getByTestId("terminal-window-c")).toBeDefined();
  });

  it("renders master-stack layout for 4 windows: 1 horizontal root, 2 vertical stack splits", () => {
    render(
      <TilingLayout
        windows={makeWindows(["a", "b", "c", "d"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    // 4 windows → root horizontal + 2 nested vertical splits in the right column
    const splits = screen.getAllByTestId("tile-split");
    expect(splits).toHaveLength(3);

    expect(screen.getByTestId("terminal-window-a")).toBeDefined();
    expect(screen.getByTestId("terminal-window-b")).toBeDefined();
    expect(screen.getByTestId("terminal-window-c")).toBeDefined();
    expect(screen.getByTestId("terminal-window-d")).toBeDefined();
  });

  it("master window (first) is the left leaf of the root horizontal split", () => {
    render(
      <TilingLayout
        windows={makeWindows(["master", "stack1", "stack2"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    // The root tile-split contains two flex children.
    // The first flex child should contain the master terminal window.
    const rootSplit = screen.getAllByTestId("tile-split")[0];
    // First flex child is the first element child of the root split (before the divider)
    const firstFlexChild = rootSplit.firstElementChild as HTMLElement;
    expect(firstFlexChild.querySelector('[data-testid="terminal-window-master"]')).not.toBeNull();

    // Second flex child (after the divider) should not contain the master window
    const lastFlexChild = rootSplit.lastElementChild as HTMLElement;
    expect(lastFlexChild.querySelector('[data-testid="terminal-window-master"]')).toBeNull();
    expect(lastFlexChild.querySelector('[data-testid="terminal-window-stack1"]')).not.toBeNull();
    expect(lastFlexChild.querySelector('[data-testid="terminal-window-stack2"]')).not.toBeNull();
  });

  it("root horizontal split uses 50/50 ratio by default", () => {
    render(
      <TilingLayout
        windows={makeWindows(["a", "b", "c"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    const rootSplit = screen.getAllByTestId("tile-split")[0];
    const firstFlexChild = rootSplit.firstElementChild as HTMLElement;
    const lastFlexChild = rootSplit.lastElementChild as HTMLElement;

    // ratio = 0.5, so first child gets flex "0.5 1 0%" and second gets "0.5 1 0%"
    expect(firstFlexChild.style.flex).toBe("0.5 1 0%");
    expect(lastFlexChild.style.flex).toBe("0.5 1 0%");
  });

  it("buildVerticalStack uses ratio 1/N for the first slot, distributing evenly", () => {
    // With 3 stack windows (b, c, d), the first vertical split has ratio = 1/3
    // so the first child flex = "0.333..." and second = "0.666..."
    render(
      <TilingLayout
        windows={makeWindows(["a", "b", "c", "d"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    const splits = screen.getAllByTestId("tile-split");
    // splits[0] = root horizontal, splits[1] = first vertical (b vs [c,d]), splits[2] = second vertical (c vs d)
    const firstVerticalSplit = splits[1];
    const firstFlexChild = firstVerticalSplit.firstElementChild as HTMLElement;
    const lastFlexChild = firstVerticalSplit.lastElementChild as HTMLElement;

    // ratio = 1/3 ≈ 0.3333...
    const expectedRatio = 1 / 3;
    expect(firstFlexChild.style.flex).toBe(`${expectedRatio} 1 0%`);
    expect(lastFlexChild.style.flex).toBe(`${1 - expectedRatio} 1 0%`);
  });

  it("second vertical split in 4-window stack uses ratio 1/2 (even distribution)", () => {
    // With 2 remaining stack windows (c, d), the nested split has ratio = 1/2
    render(
      <TilingLayout
        windows={makeWindows(["a", "b", "c", "d"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    const splits = screen.getAllByTestId("tile-split");
    const secondVerticalSplit = splits[2];
    const firstFlexChild = secondVerticalSplit.firstElementChild as HTMLElement;
    const lastFlexChild = secondVerticalSplit.lastElementChild as HTMLElement;

    // ratio = 1/2 = 0.5
    expect(firstFlexChild.style.flex).toBe("0.5 1 0%");
    expect(lastFlexChild.style.flex).toBe("0.5 1 0%");
  });
});

describe("TilingLayout — sessionStorage persistence", () => {
  let mockSessionStorage: ReturnType<typeof makeSessionStorageMock>;

  beforeEach(() => {
    mockSessionStorage = makeSessionStorageMock();
    vi.stubGlobal("sessionStorage", mockSessionStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("writes ratios to sessionStorage on initial render", () => {
    render(
      <TilingLayout
        windows={makeWindows(["a", "b"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    const setItemCalls = mockSessionStorage.setItem.mock.calls;
    const ratioCalls = setItemCalls.filter(([key]) => key === "cadence_window_ratios");
    expect(ratioCalls.length).toBeGreaterThan(0);
  });

  it("rehydrates ratios from sessionStorage on mount and applies them to the split", () => {
    const storedRatio = 0.7;
    mockSessionStorage.setItem(
      "cadence_window_ratios",
      JSON.stringify([["root", storedRatio]]),
    );

    render(
      <TilingLayout
        windows={makeWindows(["a", "b"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    const splits = screen.getAllByTestId("tile-split");
    const rootSplit = splits[0];
    const firstFlexChild = rootSplit.firstElementChild as HTMLElement;
    const lastFlexChild = rootSplit.lastElementChild as HTMLElement;

    expect(firstFlexChild.style.flex).toBe(`${storedRatio} 1 0%`);
    expect(lastFlexChild.style.flex).toBe(`${1 - storedRatio} 1 0%`);
  });

  it("prunes stale ratio entries when a window is removed", () => {
    // Seed ratios for a 4-window layout: root, root.1, and root.1.1 are all valid paths.
    // After reducing to 2 windows only "root" remains valid; root.1 and root.1.1 become stale.
    mockSessionStorage.setItem(
      "cadence_window_ratios",
      JSON.stringify([["root", 0.6], ["root.1", 0.5], ["root.1.1", 0.4]]),
    );

    const { rerender } = render(
      <TilingLayout
        windows={makeWindows(["a", "b", "c", "d"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    act(() => {
      rerender(
        <TilingLayout
          windows={makeWindows(["a", "b"])}
          onMinimize={vi.fn()}
          onTerminated={vi.fn()}
        />,
      );
    });

    const ratioCalls = mockSessionStorage.setItem.mock.calls.filter(
      ([key]) => key === "cadence_window_ratios",
    );
    const lastCall = ratioCalls.at(-1);
    expect(lastCall).toBeDefined();
    const entries: [string, number][] = JSON.parse(lastCall![1]);

    const keys = entries.map(([k]) => k);
    expect(keys).not.toContain("root.1");
    expect(keys).not.toContain("root.1.1");
    expect(keys).toContain("root");
  });

  it("writes back pruned ratios to sessionStorage after window removal", () => {
    mockSessionStorage.setItem(
      "cadence_window_ratios",
      JSON.stringify([["root", 0.6], ["root.1", 0.4]]),
    );

    const { rerender } = render(
      <TilingLayout
        windows={makeWindows(["a", "b", "c"])}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    act(() => {
      rerender(
        <TilingLayout
          windows={makeWindows(["a", "b"])}
          onMinimize={vi.fn()}
          onTerminated={vi.fn()}
        />,
      );
    });

    const ratioCalls = mockSessionStorage.setItem.mock.calls.filter(
      ([key]) => key === "cadence_window_ratios",
    );
    const lastCall = ratioCalls.at(-1);
    expect(lastCall).toBeDefined();
    const entries: [string, number][] = JSON.parse(lastCall![1]);

    expect(entries).toEqual([["root", 0.6]]);
  });
});
