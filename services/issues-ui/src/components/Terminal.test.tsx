// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// Mock @xterm/xterm — canvas APIs are not available in jsdom
// Use vi.hoisted so the array is available inside the hoisted vi.mock factory
const xtermInstances = vi.hoisted(() => [] as Array<{ focus: ReturnType<typeof vi.fn>; options: Record<string, unknown>; attachCustomKeyEventHandler: ReturnType<typeof vi.fn>; getSelection: ReturnType<typeof vi.fn> }>);
const fitAddonInstances = vi.hoisted(() => [] as Array<{ fit: ReturnType<typeof vi.fn> }>);

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockXTerm {
    loadAddon = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    onData = vi.fn();
    onResize = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    getSelection = vi.fn(() => "");
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    constructor(opts?: Record<string, unknown>) {
      this.options = opts ?? {};
      xtermInstances.push(this as unknown as { focus: ReturnType<typeof vi.fn>; options: Record<string, unknown>; attachCustomKeyEventHandler: ReturnType<typeof vi.fn>; getSelection: ReturnType<typeof vi.fn> });
    }
  },
}));

// Mock @xterm/addon-fit
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn();
    constructor() {
      fitAddonInstances.push(this as unknown as { fit: ReturnType<typeof vi.fn> });
    }
  },
}));

// Mock CSS modules
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

// Mock xterm CSS import
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { Terminal } from "./Terminal";

// ---------------------------------------------------------------------------
// MockWebSocket helper
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];

  readyState = 0; // CONNECTING
  binaryType: string = "blob";
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  send = vi.fn();
  close = vi.fn();

  constructor(public url: string, public protocols?: string | string[]) {
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  simulateClose() {
    this.readyState = 3; // CLOSED
    this.onclose?.(new CloseEvent("close"));
  }

}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Terminal", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    xtermInstances.length = 0;
    fitAddonInstances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  // 1. Connecting overlay shows spinner and "Starting session…" text on initial render
  it("shows connecting overlay with 'Starting session…' on initial render", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    expect(screen.getByTestId("terminal-connecting")).toBeDefined();
    expect(screen.getByText("Starting session…")).toBeDefined();
    expect(screen.queryByTestId("terminal-error")).toBeNull();
    expect(screen.queryByTestId("terminal-disconnected")).toBeNull();
  });

  // 2. Auto-retry on connection failure — connecting overlay stays visible during retry window
  it("keeps connecting overlay visible when connection fails and retry is scheduled", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });

    // retryCount was 0 → a retry is scheduled, state stays "connecting"
    expect(screen.getByTestId("terminal-connecting")).toBeDefined();
    expect(screen.queryByTestId("terminal-error")).toBeNull();
    expect(screen.queryByTestId("terminal-disconnected")).toBeNull();
  });

  it("creates a new WebSocket after the first retry delay fires", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    act(() => {
      MockWebSocket.instances[0].simulateClose();
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    // Advance past the first retry delay (2000 ms)
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(screen.getByTestId("terminal-connecting")).toBeDefined();
  });

  // 3. Error state after all retries exhausted (RETRY_DELAYS_MS = [2000, 4000, 8000, 16000])
  it("shows error overlay after all 4 retries are exhausted", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    // Attempt 0 fails → schedules retry after 2000 ms
    act(() => { MockWebSocket.instances[0].simulateClose(); });
    act(() => { vi.advanceTimersByTime(2000); });

    // Attempt 1 fails → schedules retry after 4000 ms
    act(() => { MockWebSocket.instances[1].simulateClose(); });
    act(() => { vi.advanceTimersByTime(4000); });

    // Attempt 2 fails → schedules retry after 8000 ms
    act(() => { MockWebSocket.instances[2].simulateClose(); });
    act(() => { vi.advanceTimersByTime(8000); });

    // Attempt 3 fails → schedules retry after 16000 ms
    act(() => { MockWebSocket.instances[3].simulateClose(); });
    act(() => { vi.advanceTimersByTime(16000); });

    // Attempt 4 fails → retries exhausted, show error
    act(() => { MockWebSocket.instances[4].simulateClose(); });

    expect(screen.getByTestId("terminal-error")).toBeDefined();
    expect(screen.getByText("Failed to connect.")).toBeDefined();
    expect(screen.getByText("Retry")).toBeDefined();
    expect(screen.queryByTestId("terminal-connecting")).toBeNull();
  });

  // 4. Manual Retry resets the retry counter so auto-retries start fresh
  it("resets retry counter when the Retry button is clicked", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    // Exhaust all retries
    act(() => { MockWebSocket.instances[0].simulateClose(); });
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { MockWebSocket.instances[1].simulateClose(); });
    act(() => { vi.advanceTimersByTime(4000); });
    act(() => { MockWebSocket.instances[2].simulateClose(); });
    act(() => { vi.advanceTimersByTime(8000); });
    act(() => { MockWebSocket.instances[3].simulateClose(); });
    act(() => { vi.advanceTimersByTime(16000); });
    act(() => { MockWebSocket.instances[4].simulateClose(); });

    expect(screen.getByTestId("terminal-error")).toBeDefined();

    // Click Retry — should reset counter and return to "connecting"
    act(() => {
      fireEvent.click(screen.getByText("Retry"));
    });

    expect(screen.getByTestId("terminal-connecting")).toBeDefined();
    expect(screen.queryByTestId("terminal-error")).toBeNull();

    // Fail the fresh connection — auto-retry should begin again, not immediately hit error
    const latestWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => { latestWs.simulateClose(); });

    // First auto-retry is scheduled; still "connecting", not "error"
    expect(screen.getByTestId("terminal-connecting")).toBeDefined();
    expect(screen.queryByTestId("terminal-error")).toBeNull();
  });

  // 5. After open→close the component enters "reconnecting" state (auto-retry), NOT "disconnected"
  it("shows reconnecting overlay with 'Reconnecting…' after open then close", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    const ws = MockWebSocket.instances[0];

    act(() => { ws.simulateOpen(); });
    // After a successful open the connecting overlay should disappear
    expect(screen.queryByTestId("terminal-connecting")).toBeNull();

    act(() => { ws.simulateClose(); });

    expect(screen.getByTestId("terminal-reconnecting")).toBeDefined();
    expect(screen.getByText("Reconnecting…")).toBeDefined();
    expect(screen.queryByTestId("terminal-disconnected")).toBeNull();
    expect(screen.queryByTestId("terminal-error")).toBeNull();
    expect(screen.queryByTestId("terminal-connecting")).toBeNull();
  });

  // 6. Clicking the terminal container focuses the xterm instance (issue #199)
  it("focuses the xterm instance when the terminal container is clicked", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    const ws = MockWebSocket.instances[0];
    act(() => { ws.simulateOpen(); });

    const container = screen.getByTestId("terminal-container");
    fireEvent.click(container);

    expect(xtermInstances).toHaveLength(1);
    expect(xtermInstances[0].focus).toHaveBeenCalledTimes(1);
  });

  // 7. xterm.js Terminal must be constructed with scroll-related options (issue #248)
  it("constructs xterm.js Terminal with scrollback >= 5000 and scrollSensitivity >= 1", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    const ws = MockWebSocket.instances[0];
    act(() => { ws.simulateOpen(); });

    expect(xtermInstances).toHaveLength(1);
    const opts = xtermInstances[0].options;
    expect(typeof opts.scrollback).toBe("number");
    expect(opts.scrollback as number).toBeGreaterThanOrEqual(5000);
    expect(typeof opts.scrollSensitivity).toBe("number");
    expect(opts.scrollSensitivity as number).toBeGreaterThanOrEqual(1);
  });

  // 7b. xterm.js Terminal must be constructed with rightClickSelectsWord and macOptionIsMeta (issue #306)
  it("constructs xterm.js Terminal with rightClickSelectsWord: true and macOptionIsMeta: true", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    expect(xtermInstances).toHaveLength(1);
    const opts = xtermInstances[0].options;
    expect(opts.rightClickSelectsWord).toBe(true);
    expect(opts.macOptionIsMeta).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Resize behavior: a window resize should only call fit(), not reconnect
  // ---------------------------------------------------------------------------
  describe("resize behavior", () => {
    it("calls fit() on resize without creating a new WebSocket or XTerm instance", () => {
      // Capture the ResizeObserver callback when the component registers it
      let capturedResizeCallback: (() => void) | null = null;
      vi.stubGlobal("ResizeObserver", class {
        constructor(callback: () => void) {
          capturedResizeCallback = callback;
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      });

      render(<Terminal agentName="test-agent" sessionId="test-session" />);

      // Simulate a successful WebSocket open so we are in "connected" state
      act(() => {
        MockWebSocket.instances[0].simulateOpen();
      });

      // Sanity: exactly 1 WebSocket and 1 XTerm created so far
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(xtermInstances).toHaveLength(1);

      // The ResizeObserver callback must have been captured
      expect(capturedResizeCallback).not.toBeNull();

      // Fire the resize callback (simulates a browser window resize)
      act(() => {
        capturedResizeCallback!();
        vi.runAllTimers();
      });

      // Bug: if a reconnect happened, a 2nd WebSocket and 2nd XTerm would exist.
      // The correct behavior is that ONLY fit() is called — no new connections.
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(xtermInstances).toHaveLength(1);

      // fit() should have been called (resize was handled)
      expect(fitAddonInstances).toHaveLength(1);
      expect(fitAddonInstances[0].fit).toHaveBeenCalled();
    });
  });

  // 8. On WebSocket open, a correctly-prefixed CMD_RESIZE frame is sent so the PTY gets initial dimensions (#317)
  it("sends a CMD_RESIZE frame ('1' prefix) with terminal dimensions immediately on connection open", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    const ws = MockWebSocket.instances[0];
    act(() => { ws.simulateOpen(); });

    // The first send() call must be a resize frame (prefix "1") with cols/rows from xterm
    expect(ws.send).toHaveBeenCalled();
    const firstCall = ws.send.mock.calls[0][0] as string;
    expect(firstCall[0]).toBe("1");
    const payload = JSON.parse(firstCall.slice(1)) as { columns: number; rows: number };
    expect(typeof payload.columns).toBe("number");
    expect(typeof payload.rows).toBe("number");
    expect(payload.columns).toBeGreaterThan(0);
    expect(payload.rows).toBeGreaterThan(0);
  });

  // 9. Right-click on terminal container must NOT suppress the browser native context menu.
  it("does not suppress the browser native context menu (contextmenu event default NOT prevented)", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    const container = screen.getByTestId("terminal-container");

    // A second listener on the same element reads e.defaultPrevented after
    // any component handler fires — per the DOM spec, defaultPrevented is
    // visible to all listeners within the same dispatch, so this is reliable.
    let defaultPrevented = false;
    container.addEventListener("contextmenu", (e) => {
      defaultPrevented = e.defaultPrevented;
    });

    fireEvent.contextMenu(container);

    expect(defaultPrevented).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Auto-reconnect after a dropped connection
  // ---------------------------------------------------------------------------
  describe("auto-reconnect after drop", () => {
    // a. After open→close, shows "reconnecting" overlay
    it("shows terminal-reconnecting overlay with 'Reconnecting…' text after open then close", () => {
      render(<Terminal agentName="agent-1" sessionId="sess-1" />);

      act(() => { MockWebSocket.instances[0].simulateOpen(); });
      expect(screen.queryByTestId("terminal-connecting")).toBeNull();

      act(() => { MockWebSocket.instances[0].simulateClose(); });

      expect(screen.getByTestId("terminal-reconnecting")).toBeDefined();
      expect(screen.getByText("Reconnecting…")).toBeDefined();
      expect(screen.queryByTestId("terminal-disconnected")).toBeNull();
      expect(screen.queryByTestId("terminal-error")).toBeNull();
    });

    // b. Auto-retry creates a new WebSocket after first backoff delay (2000 ms)
    it("creates a new WebSocket after the first reconnect backoff delay", () => {
      render(<Terminal agentName="agent-1" sessionId="sess-1" />);

      act(() => { MockWebSocket.instances[0].simulateOpen(); });
      act(() => { MockWebSocket.instances[0].simulateClose(); });

      // Only 1 WS so far — the timer is pending
      expect(MockWebSocket.instances).toHaveLength(1);

      // Advance past the first reconnect delay (2000 ms)
      act(() => { vi.advanceTimersByTime(2000); });

      expect(MockWebSocket.instances).toHaveLength(2);
    });

    // c. After all 4 reconnect retries exhausted, shows "disconnected"
    it("shows terminal-disconnected with 'Connection lost.' after all 4 reconnect retries are exhausted", () => {
      render(<Terminal agentName="agent-1" sessionId="sess-1" />);

      // Initial connection succeeds
      act(() => { MockWebSocket.instances[0].simulateOpen(); });

      // Drop 1 → schedule reconnect after 2000 ms
      act(() => { MockWebSocket.instances[0].simulateClose(); });
      act(() => { vi.advanceTimersByTime(2000); });

      // Reconnect attempt 1 fails → schedule after 4000 ms
      act(() => { MockWebSocket.instances[1].simulateClose(); });
      act(() => { vi.advanceTimersByTime(4000); });

      // Reconnect attempt 2 fails → schedule after 8000 ms
      act(() => { MockWebSocket.instances[2].simulateClose(); });
      act(() => { vi.advanceTimersByTime(8000); });

      // Reconnect attempt 3 fails → schedule after 16000 ms
      act(() => { MockWebSocket.instances[3].simulateClose(); });
      act(() => { vi.advanceTimersByTime(16000); });

      // Reconnect attempt 4 fails → retries exhausted → disconnected
      act(() => { MockWebSocket.instances[4].simulateClose(); });

      expect(screen.getByTestId("terminal-disconnected")).toBeDefined();
      expect(screen.getByText("Connection lost.")).toBeDefined();
      expect(screen.getByText("Reconnect")).toBeDefined();
      expect(screen.queryByTestId("terminal-reconnecting")).toBeNull();
      expect(screen.queryByTestId("terminal-error")).toBeNull();
    });

    // d. "Connect now" button during reconnect resets and reconnects
    it("'Connect now' button resets to connecting state and starts a fresh connection", () => {
      render(<Terminal agentName="agent-1" sessionId="sess-1" />);

      // Establish then drop to enter reconnecting state
      act(() => { MockWebSocket.instances[0].simulateOpen(); });
      act(() => { MockWebSocket.instances[0].simulateClose(); });

      expect(screen.getByTestId("terminal-reconnecting")).toBeDefined();
      expect(MockWebSocket.instances).toHaveLength(1);

      // Click "Connect now" — triggers an immediate manual connect
      act(() => {
        fireEvent.click(screen.getByText("Connect now"));
      });

      // Should be back in "connecting" (not "reconnecting") with a new WS
      expect(screen.getByTestId("terminal-connecting")).toBeDefined();
      expect(screen.queryByTestId("terminal-reconnecting")).toBeNull();
      expect(MockWebSocket.instances).toHaveLength(2);

      // If the new WS also closes without connecting, retry counter was reset
      // so there are still retries remaining — stays "connecting", not "disconnected"
      act(() => { MockWebSocket.instances[1].simulateClose(); });

      expect(screen.getByTestId("terminal-connecting")).toBeDefined();
      expect(screen.queryByTestId("terminal-disconnected")).toBeNull();
      expect(screen.queryByTestId("terminal-error")).toBeNull();
    });

    // e. Unmount during pending reconnect cancels the timer
    it("cancels the pending reconnect timer on unmount so no new WebSocket is created", () => {
      const { unmount } = render(<Terminal agentName="agent-1" sessionId="sess-1" />);

      // Establish then drop — reconnect timer is now pending
      act(() => { MockWebSocket.instances[0].simulateOpen(); });
      act(() => { MockWebSocket.instances[0].simulateClose(); });

      expect(MockWebSocket.instances).toHaveLength(1);

      // Unmount before the timer fires
      act(() => { unmount(); });

      // Advance past the reconnect delay — the cleared timer must NOT fire
      act(() => { vi.advanceTimersByTime(2000); });

      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });

});

describe("clipboard copy trimming", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    xtermInstances.length = 0;
    fitAddonInstances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn() } });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  // Helper: render Terminal and advance to connected state
  function renderConnected() {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);
    act(() => { MockWebSocket.instances[0].simulateOpen(); });
  }

  // 1. attachCustomKeyEventHandler is called on the xterm Terminal instance
  it("calls attachCustomKeyEventHandler on the xterm Terminal instance", () => {
    renderConnected();
    expect(xtermInstances).toHaveLength(1);
    expect(xtermInstances[0].attachCustomKeyEventHandler).toHaveBeenCalled();
  });

  // 2. Ctrl+C with active selection: trims trailing whitespace and writes to clipboard
  it("Ctrl+C with active selection trims trailing whitespace and writes to clipboard", async () => {
    renderConnected();
    const term = xtermInstances[0];
    term.getSelection.mockReturnValue("hello   \nworld  \n  ");

    // Retrieve and call the registered key event handler
    const handler = term.attachCustomKeyEventHandler.mock.calls[0][0] as (e: { key: string; ctrlKey: boolean; metaKey: boolean; type: string }) => boolean;
    const result = handler({ key: "c", ctrlKey: true, metaKey: false, type: "keydown" });

    // Handler should return false (prevents default xterm behavior)
    expect(result).toBe(false);

    // Clipboard should receive the trimmed text (trailing whitespace removed, blank trailing lines dropped)
    expect((navigator.clipboard as { writeText: ReturnType<typeof vi.fn> }).writeText).toHaveBeenCalledWith("hello\nworld");
  });

  // 3. Cmd+C (metaKey) with active selection: same trimming behavior
  it("Cmd+C with active selection trims trailing whitespace and writes to clipboard", async () => {
    renderConnected();
    const term = xtermInstances[0];
    term.getSelection.mockReturnValue("foo   \nbar  ");

    const handler = term.attachCustomKeyEventHandler.mock.calls[0][0] as (e: { key: string; ctrlKey: boolean; metaKey: boolean; type: string }) => boolean;
    const result = handler({ key: "c", ctrlKey: false, metaKey: true, type: "keydown" });

    expect(result).toBe(false);
    expect((navigator.clipboard as { writeText: ReturnType<typeof vi.fn> }).writeText).toHaveBeenCalledWith("foo\nbar");
  });

  // 4. Ctrl+C with NO selection: handler returns true, clipboard NOT written
  it("Ctrl+C with no selection returns true and does not write to clipboard", () => {
    renderConnected();
    const term = xtermInstances[0];
    term.getSelection.mockReturnValue("");

    const handler = term.attachCustomKeyEventHandler.mock.calls[0][0] as (e: { key: string; ctrlKey: boolean; metaKey: boolean; type: string }) => boolean;
    const result = handler({ key: "c", ctrlKey: true, metaKey: false, type: "keydown" });

    // Handler returns true so xterm processes the key normally (SIGINT)
    expect(result).toBe(true);
    expect((navigator.clipboard as { writeText: ReturnType<typeof vi.fn> }).writeText).not.toHaveBeenCalled();
  });

  // 5. copy DOM event with active xterm selection: trims and sets clipboardData
  it("copy DOM event with active xterm selection trims trailing whitespace and sets clipboardData", () => {
    renderConnected();
    const term = xtermInstances[0];
    term.getSelection.mockReturnValue("line one   \nline two  ");

    const container = screen.getByTestId("terminal-container");

    // Build a synthetic copy Event with a clipboardData mock (ClipboardEvent not available in jsdom)
    const setData = vi.fn();
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, "clipboardData", { value: { setData }, writable: false });

    act(() => { container.dispatchEvent(copyEvent); });

    expect(setData).toHaveBeenCalledWith("text/plain", "line one\nline two");
  });

  // 6. copy DOM event with NO active xterm selection: clipboard is not modified
  it("copy DOM event with no active xterm selection does not modify clipboardData", () => {
    renderConnected();
    const term = xtermInstances[0];
    term.getSelection.mockReturnValue("");

    const container = screen.getByTestId("terminal-container");

    const setData = vi.fn();
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, "clipboardData", { value: { setData }, writable: false });

    act(() => { container.dispatchEvent(copyEvent); });

    expect(setData).not.toHaveBeenCalled();
  });
});
