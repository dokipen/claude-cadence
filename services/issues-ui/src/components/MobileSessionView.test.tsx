// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "../gen/hub/v1/hub_pb";
import type { TiledWindow } from "./TilingLayout";
import type { TerminalHandle } from "./Terminal";

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
    mobileHeader: "mobileHeader",
    mobileSessionContent: "mobileSessionContent",
    mobileBackButton: "mobileBackButton",
    mobileEscButton: "mobileEscButton",
    mobileCloseButton: "mobileCloseButton",
  },
}));

// Mock Terminal — it depends on xterm and WebSocket which are unavailable in jsdom.
// Wrapped in forwardRef + useImperativeHandle so MobileSessionView can call sendInput via ref.
const mockSendInput = vi.fn();
vi.mock("./Terminal", () => ({
  Terminal: forwardRef<TerminalHandle, { agentName: string; sessionId: string }>(
    function MockTerminal({ agentName, sessionId }, ref) {
      useImperativeHandle(ref, () => ({ sendInput: mockSendInput }));
      return <div data-testid="terminal" data-agent={agentName} data-session={sessionId} />;
    }
  ),
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
  mockSendInput.mockReset();
  cleanup();
});

describe("MobileSessionView", () => {
  it("renders back button, esc button, close button, and terminal", () => {
    const win = makeWindow("sess-1", "test-agent");
    const { getByRole, getByTestId } = render(
      <MobileSessionView win={win} onBack={vi.fn()} onClose={vi.fn()} />,
    );

    expect(getByRole("button", { name: /back to agent list/i })).not.toBeNull();
    expect(getByRole("button", { name: /send escape/i })).not.toBeNull();
    expect(getByRole("button", { name: /close session/i })).not.toBeNull();
    expect(getByTestId("terminal")).not.toBeNull();
  });

  it("passes agentName and sessionId to Terminal", () => {
    const win = makeWindow("sess-1", "test-agent");
    const { getByTestId } = render(
      <MobileSessionView win={win} onBack={vi.fn()} onClose={vi.fn()} />,
    );

    const terminal = getByTestId("terminal");
    expect(terminal.dataset.agent).toBe("test-agent");
    expect(terminal.dataset.session).toBe("sess-1");
  });

  it("calls onBack when the back button is clicked", async () => {
    const win = makeWindow("sess-2", "test-agent");
    const onBack = vi.fn();
    const { getByRole } = render(
      <MobileSessionView win={win} onBack={onBack} onClose={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: /back to agent list/i }));
    });

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("calls onClose when the close button is clicked", async () => {
    const win = makeWindow("sess-2b", "test-agent");
    const onClose = vi.fn();
    const { getByRole } = render(
      <MobileSessionView win={win} onBack={vi.fn()} onClose={onClose} />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: /close session/i }));
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sends escape character to terminal when Esc button is clicked", async () => {
    const win = makeWindow("sess-2c", "test-agent");
    const { getByRole } = render(
      <MobileSessionView win={win} onBack={vi.fn()} onClose={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: /send escape/i }));
    });

    expect(mockSendInput).toHaveBeenCalledWith("\x1b");
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
      const win = makeWindow("sess-3", "test-agent");
      const { getByTestId } = render(
        <MobileSessionView win={win} onBack={vi.fn()} onClose={vi.fn()} />,
      );

      const container = getByTestId("mobile-session-view");
      expect(container.style.height).toBe("800px");
    });

    it("registers resize and scroll listeners on visualViewport", () => {
      const win = makeWindow("sess-4", "test-agent");
      render(
        <MobileSessionView win={win} onBack={vi.fn()} onClose={vi.fn()} />,
      );

      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
      // iOS Safari fires "scroll" (not "resize") when the keyboard appears
      expect(mockVisualViewport.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    });

    it("removes both listeners on unmount", () => {
      const win = makeWindow("sess-5", "test-agent");
      const { unmount } = render(
        <MobileSessionView win={win} onBack={vi.fn()} onClose={vi.fn()} />,
      );

      unmount();

      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
      expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    });

    it("updates height when visualViewport fires a resize event", async () => {
      const win = makeWindow("sess-6", "test-agent");
      const { getByTestId } = render(
        <MobileSessionView win={win} onBack={vi.fn()} onClose={vi.fn()} />,
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

    it("updates height when visualViewport fires a scroll event (iOS keyboard)", async () => {
      const win = makeWindow("sess-7", "test-agent");
      const { getByTestId } = render(
        <MobileSessionView win={win} onBack={vi.fn()} onClose={vi.fn()} />,
      );

      // Simulate iOS keyboard appearing via scroll event
      mockVisualViewport.height = 450;
      const scrollCall = mockVisualViewport.addEventListener.mock.calls.find(
        ([event]) => event === "scroll",
      );
      const scrollHandler = scrollCall![1] as () => void;
      await act(async () => {
        scrollHandler();
      });

      const container = getByTestId("mobile-session-view");
      expect(container.style.height).toBe("450px");
    });
  });
});

