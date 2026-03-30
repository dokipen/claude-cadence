// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "../gen/hub/v1/hub_pb";
import type { TiledWindow } from "./TilingLayout";

// ---------------------------------------------------------------------------
// Hoisted mutable state
// ---------------------------------------------------------------------------
const { mockVisualViewport } = vi.hoisted(() => ({
  mockVisualViewport: {
    height: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
}));

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({
  default: {
    mobileSessionView: "mobileSessionView",
    mobileSessionContent: "mobileSessionContent",
    mobileBackButton: "mobileBackButton",
  },
}));

// Mock TerminalWindow — it depends on xterm and WebSocket which are unavailable in jsdom
let capturedOnMinimize: (() => void) | undefined;
let capturedOnTerminated: (() => void) | undefined;
vi.mock("./TerminalWindow", () => ({
  TerminalWindow: ({
    onMinimize,
    onTerminated,
  }: {
    session: unknown;
    agentName: string;
    projectId?: string;
    onMinimize: () => void;
    onTerminated: () => void;
  }) => {
    capturedOnMinimize = onMinimize;
    capturedOnTerminated = onTerminated;
    return <div data-testid="terminal-window" />;
  },
}));

import { MobileSessionView } from "./MobileSessionView";

const makeWindow = (id: string, agentName: string): TiledWindow => ({
  key: `${agentName}:${id}`,
  agentName,
  session: create(SessionSchema, {
    id,
    name: `session-${id}`,
    agentProfile: "default",
    state: "running",
    createdAt: "2024-01-01T00:00:00Z",
    agentPid: 1234,
    repoUrl: "https://github.com/example/repo",
    baseRef: "main",
    waitingForInput: false,
  }),
});

afterEach(() => {
  capturedOnMinimize = undefined;
  capturedOnTerminated = undefined;
  cleanup();
});

describe("MobileSessionView", () => {
  it("renders the back button and terminal window", () => {
    const win = makeWindow("sess-1", "test-agent");
    const { getByRole, getByTestId } = render(
      <MobileSessionView
        win={win}
        onBack={vi.fn()}
        onMinimize={vi.fn()}
        onTerminated={vi.fn()}
      />,
    );

    expect(getByRole("button", { name: /back to agent list/i })).not.toBeNull();
    expect(getByTestId("terminal-window")).not.toBeNull();
  });

  it("calls onBack when the back button is clicked", async () => {
    const win = makeWindow("sess-2", "test-agent");
    const onBack = vi.fn();
    const { getByRole } = render(
      <MobileSessionView win={win} onBack={onBack} onMinimize={vi.fn()} onTerminated={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: /back to agent list/i }));
    });

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("calls onMinimize with the window key when TerminalWindow calls onMinimize", async () => {
    const win = makeWindow("sess-3", "test-agent");
    const onMinimize = vi.fn();
    render(
      <MobileSessionView win={win} onBack={vi.fn()} onMinimize={onMinimize} onTerminated={vi.fn()} />,
    );

    await act(async () => {
      capturedOnMinimize!();
    });

    expect(onMinimize).toHaveBeenCalledWith("test-agent:sess-3");
  });

  it("calls onTerminated with the window key when TerminalWindow calls onTerminated", async () => {
    const win = makeWindow("sess-4", "test-agent");
    const onTerminated = vi.fn();
    render(
      <MobileSessionView win={win} onBack={vi.fn()} onMinimize={vi.fn()} onTerminated={onTerminated} />,
    );

    await act(async () => {
      capturedOnTerminated!();
    });

    expect(onTerminated).toHaveBeenCalledWith("test-agent:sess-4");
  });

  describe("visualViewport height tracking", () => {
    beforeEach(() => {
      Object.defineProperty(window, "visualViewport", {
        value: mockVisualViewport,
        writable: true,
        configurable: true,
      });
      mockVisualViewport.height = 800;
      mockVisualViewport.addEventListener.mockReset();
      mockVisualViewport.removeEventListener.mockReset();
    });

    afterEach(() => {
      Object.defineProperty(window, "visualViewport", {
        value: null,
        writable: true,
        configurable: true,
      });
    });

    it("sets initial height from visualViewport", () => {
      const win = makeWindow("sess-5", "test-agent");
      const { getByTestId } = render(
        <MobileSessionView win={win} onBack={vi.fn()} onMinimize={vi.fn()} onTerminated={vi.fn()} />,
      );

      const container = getByTestId("mobile-session-view");
      expect(container.style.height).toBe("800px");
    });

    it("registers a resize listener on visualViewport", () => {
      const win = makeWindow("sess-6", "test-agent");
      render(
        <MobileSessionView win={win} onBack={vi.fn()} onMinimize={vi.fn()} onTerminated={vi.fn()} />,
      );

      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    });

    it("removes the resize listener on unmount", () => {
      const win = makeWindow("sess-7", "test-agent");
      const { unmount } = render(
        <MobileSessionView win={win} onBack={vi.fn()} onMinimize={vi.fn()} onTerminated={vi.fn()} />,
      );

      unmount();

      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    });

    it("updates height when visualViewport fires a resize event", async () => {
      const win = makeWindow("sess-8", "test-agent");
      const { getByTestId } = render(
        <MobileSessionView win={win} onBack={vi.fn()} onMinimize={vi.fn()} onTerminated={vi.fn()} />,
      );

      // Simulate keyboard appearing: viewport shrinks from 800 to 500
      mockVisualViewport.height = 500;
      const resizeHandler = mockVisualViewport.addEventListener.mock.calls[0][1] as () => void;
      await act(async () => {
        resizeHandler();
      });

      const container = getByTestId("mobile-session-view");
      expect(container.style.height).toBe("500px");
    });
  });
});
