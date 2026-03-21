// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// Mock @xterm/xterm — canvas APIs are not available in jsdom
vi.mock("@xterm/xterm", () => ({
  Terminal: class MockXTerm {
    loadAddon = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    onData = vi.fn();
    onResize = vi.fn();
    write = vi.fn();
    cols = 80;
    rows = 24;
  },
}));

// Mock @xterm/addon-fit
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn();
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

  simulateError() {
    this.onerror?.(new Event("error"));
    this.simulateClose();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Terminal", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
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

  // 5. Disconnected state when onopen fires then onclose fires
  it("shows disconnected overlay with 'Connection lost.' after open then close", () => {
    render(<Terminal agentName="agent-1" sessionId="sess-1" />);

    const ws = MockWebSocket.instances[0];

    act(() => { ws.simulateOpen(); });
    // After a successful open the connecting overlay should disappear
    expect(screen.queryByTestId("terminal-connecting")).toBeNull();

    act(() => { ws.simulateClose(); });

    expect(screen.getByTestId("terminal-disconnected")).toBeDefined();
    expect(screen.getByText("Connection lost.")).toBeDefined();
    expect(screen.getByText("Reconnect")).toBeDefined();
    expect(screen.queryByTestId("terminal-error")).toBeNull();
    expect(screen.queryByTestId("terminal-connecting")).toBeNull();
  });
});
