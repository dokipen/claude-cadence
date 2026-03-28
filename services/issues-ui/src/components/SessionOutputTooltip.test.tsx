// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import React from "react";
import type { ActiveSessionInfo } from "../types";

// Mock @xterm/xterm — canvas APIs are not available in jsdom
const xtermInstances = vi.hoisted(() => [] as Array<{
  loadAddon: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  cols: number;
  rows: number;
}>);
const fitAddonInstances = vi.hoisted(() => [] as Array<{ fit: ReturnType<typeof vi.fn> }>);

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockXTerm {
    loadAddon = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    write = vi.fn();
    onData = vi.fn();
    cols = 80;
    rows = 24;
    constructor() {
      xtermInstances.push(this as unknown as typeof xtermInstances[number]);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn();
    constructor() {
      fitAddonInstances.push(this as unknown as { fit: ReturnType<typeof vi.fn> });
    }
  },
}));

// Mock CSS modules
vi.mock("../styles/session-output-tooltip.module.css", () => ({ default: {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { SessionOutputTooltip } from "./SessionOutputTooltip";

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

  simulateMessage(data: string | ArrayBuffer) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

// ---------------------------------------------------------------------------

const makeSession = (overrides: Partial<ActiveSessionInfo> = {}): ActiveSessionInfo => ({
  name: "lead-5",
  state: "running",
  sessionId: "session-abc",
  agentName: "my-agent",
  ...overrides,
});

describe("SessionOutputTooltip", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    xtermInstances.length = 0;
    fitAddonInstances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("does not show tooltip before hover", () => {
    const session = makeSession();
    const { queryByTestId } = render(
      <SessionOutputTooltip session={session}>
        <span data-testid="icon">icon</span>
      </SessionOutputTooltip>,
    );
    expect(queryByTestId("session-output-tooltip")).toBeNull();
  });

  it("shows tooltip on mouseenter", async () => {
    const session = makeSession();
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

  it("hides tooltip on mouseleave", async () => {
    const session = makeSession();
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

  it("opens a WebSocket to the terminal endpoint on hover", async () => {
    const session = makeSession({ agentName: "my-agent", sessionId: "sess-1" });
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain("/ws/terminal/my-agent/sess-1");
  });

  it("does not open a WebSocket when sessionId is missing", async () => {
    const session = makeSession({ sessionId: undefined });
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("does not open a WebSocket when agentName is missing", async () => {
    const session = makeSession({ agentName: undefined });
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("sends CMD_RESIZE on WebSocket open", async () => {
    const session = makeSession();
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => {
      MockWebSocket.instances[0].simulateOpen();
    });
    expect(MockWebSocket.instances[0].send).toHaveBeenCalledTimes(1);
    const sent = MockWebSocket.instances[0].send.mock.calls[0][0] as string;
    expect(sent.startsWith("1")).toBe(true); // CMD_RESIZE = "1"
    const payload = JSON.parse(sent.slice(1));
    expect(payload).toHaveProperty("columns");
    expect(payload).toHaveProperty("rows");
  });

  it("writes binary output frames to xterm", async () => {
    const session = makeSession();
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => {
      MockWebSocket.instances[0].simulateOpen();
    });

    // Binary frame: type byte 0x30 ("0") + data bytes
    const data = new Uint8Array([0x30, 0x68, 0x69]); // "0hi"
    await act(async () => {
      MockWebSocket.instances[0].simulateMessage(data.buffer);
    });

    expect(xtermInstances).toHaveLength(1);
    expect(xtermInstances[0].write).toHaveBeenCalled();
  });

  it("does not register onData (readonly — no input forwarded)", async () => {
    const session = makeSession();
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    expect(xtermInstances).toHaveLength(1);
    expect(xtermInstances[0].onData).not.toHaveBeenCalled();
  });

  it("closes WebSocket and disposes xterm on mouseleave", async () => {
    const session = makeSession();
    const { container } = render(
      <SessionOutputTooltip session={session}>
        <span>icon</span>
      </SessionOutputTooltip>,
    );
    await act(async () => {
      fireEvent.mouseEnter(container.firstChild as Element);
    });
    await act(async () => {
      MockWebSocket.instances[0].simulateOpen();
    });

    const ws = MockWebSocket.instances[0];
    const term = xtermInstances[0];

    await act(async () => {
      fireEvent.mouseLeave(container.firstChild as Element);
    });

    expect(ws.close).toHaveBeenCalled();
    expect(term.dispose).toHaveBeenCalled();
  });
});
