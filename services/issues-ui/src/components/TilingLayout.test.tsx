// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

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

const makeSession = (id: string) => ({
  id,
  name: `session-${id}`,
  state: "running" as const,
  agent_profile: "default",
  tmux_session: `tmux-${id}`,
  created_at: "2026-01-01T00:00:00Z",
  agent_pid: 1234,
  worktree_path: "/tmp/worktree",
  base_ref: "main",
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
