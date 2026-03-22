import { useRef, useEffect, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import styles from "../styles/agents.module.css";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

interface TerminalProps {
  agentName: string;
  sessionId: string;
}

// ttyd protocol message types (single-byte prefix on binary messages).
// Client → server
const CMD_INPUT = "0"; // terminal input
const CMD_RESIZE = "1"; // JSON {columns, rows}
// Server → client
const MSG_OUTPUT = "0"; // terminal output
// const MSG_SET_TITLE = "1";
// const MSG_SET_PREFS = "2";

const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000];

function buildWsUrl(agentName: string, sessionId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/terminal/${encodeURIComponent(agentName)}/${encodeURIComponent(sessionId)}`;
}

export function Terminal({ agentName, sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const everConnectedRef = useRef(false);
  const isAutoRetryRef = useRef(false);
  const [connState, setConnState] = useState<ConnectionState>("connecting");

  const connect = useCallback(() => {
    // Clear any pending retry timer
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    // Manual connect resets retry counter; auto-retry preserves it.
    // everConnectedRef always resets: a manual Reconnect after a drop starts a
    // fresh retry cycle rather than immediately showing "Connection lost." again.
    if (!isAutoRetryRef.current) {
      retryCountRef.current = 0;
    }
    isAutoRetryRef.current = false;
    everConnectedRef.current = false;

    const container = containerRef.current;
    if (!container) return;

    // Clean up previous terminal if reconnecting
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }

    setConnState("connecting");

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      scrollback: 5000,
      scrollSensitivity: 1,
      fastScrollSensitivity: 5,
      rightClickSelectsWord: true,
      macOptionIsMeta: true,
      theme: {
        // Cadence dark palette — all foreground colors verified ≥ 4.5:1 contrast vs #0d1117
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#00D4AF",
        selectionBackground: "rgba(61, 91, 200, 0.4)",
        selectionForeground: "#e6edf3",
        black: "#484f58",
        red: "#f85149",        // cadence --error
        green: "#4ADE80",      // green-400, 9.9:1
        yellow: "#F5B74A",     // cadence --amber, 9.7:1
        blue: "#6B8AFF",       // cadence --primary-light, 5.5:1
        magenta: "#C084FC",    // violet-400, 6.6:1
        cyan: "#00D4AF",       // cadence --accent, 9.1:1
        white: "#c9d1d9",      // mid-gray, 11.3:1
        brightBlack: "#8b949e", // cadence --text-secondary, 5.6:1
        brightRed: "#ff8585",   // 7.4:1
        brightGreen: "#6EE7B7", // emerald-300, 11.6:1
        brightYellow: "#FCD34D", // amber-300, 11.9:1
        brightBlue: "#93B4FF",   // 8.4:1
        brightMagenta: "#DDA0FF", // 8.7:1
        brightCyan: "#34EFD5",    // bright accent, 11.9:1
        brightWhite: "#f0f6fc",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Close any previous WebSocket before creating a new one.
    wsRef.current?.close();

    const url = buildWsUrl(agentName, sessionId);
    // Request the "tty" subprotocol required by ttyd.
    const ws = new WebSocket(url, ["tty"]);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      everConnectedRef.current = true;
      retryCountRef.current = 0;
      setConnState("connected");

      // Re-fit after connection to capture final layout dimensions, then send
      // the initial resize frame so the PTY is sized correctly from the start.
      // fit() is called before onResize is registered to avoid a double-send.
      fit.fit();
      const { cols, rows } = term;
      // Guard: skip if the container has no rendered size yet (hidden tab,
      // zero-height tile). The ResizeObserver will fire once the container
      // becomes visible and term.onResize will send the correct frame then.
      if (cols > 0 && rows > 0) {
        ws.send(CMD_RESIZE + JSON.stringify({ columns: cols, rows }));
      }

      // Forward terminal input to ttyd with the INPUT prefix.
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(CMD_INPUT + data);
        }
      });

      // Send resize events when the terminal dimensions change.
      term.onResize(({ cols: c, rows: r }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(CMD_RESIZE + JSON.stringify({ columns: c, rows: r }));
        }
      });
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const view = new Uint8Array(ev.data);
        if (view.length < 1) return;
        const cmd = String.fromCharCode(view[0]);
        if (cmd === MSG_OUTPUT) {
          // Strip the type prefix and write the rest to xterm.
          term.write(view.slice(1));
        }
        // SET_WINDOW_TITLE and SET_PREFERENCES are ignored for now.
      } else if (typeof ev.data === "string") {
        // Some ttyd versions send text frames; handle the prefix the same way.
        if (ev.data.length < 1) return;
        const cmd = ev.data[0];
        if (cmd === MSG_OUTPUT) {
          term.write(ev.data.slice(1));
        }
      }
    };

    ws.onerror = () => {
      // Connection error; handled by onclose which fires immediately after.
    };

    ws.onclose = () => {
      if (everConnectedRef.current) {
        // Was connected, then lost the connection.
        setConnState("disconnected");
      } else if (retryCountRef.current < RETRY_DELAYS_MS.length) {
        // Never connected — schedule an auto-retry with backoff.
        const delay = RETRY_DELAYS_MS[retryCountRef.current];
        retryCountRef.current += 1;
        setConnState("connecting");
        isAutoRetryRef.current = true;
        retryTimerRef.current = setTimeout(connect, delay);
      } else {
        // Retries exhausted — show permanent error.
        setConnState("error");
      }
    };
  }, [agentName, sessionId]);

  // Initial connection
  useEffect(() => {
    connect();

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      termRef.current?.dispose();
      wsRef.current?.close();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, [connect]);

  // Handle resize — debounced with rAF to avoid flooding CMD_RESIZE on rapid window drag
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        fitRef.current?.fit();
      });
    });
    observer.observe(container);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={styles.terminalWrapper} data-testid="terminal-wrapper">
      <div
        ref={containerRef}
        className={styles.terminalContainer}
        data-testid="terminal-container"
        onClick={() => termRef.current?.focus()}
      />
      {connState === "connecting" && (
        <div className={styles.terminalOverlay} data-testid="terminal-connecting">
          <div className={styles.spinner} />
          <span>Starting session…</span>
        </div>
      )}
      {connState === "disconnected" && (
        <div className={styles.terminalOverlay} data-testid="terminal-disconnected">
          <span>Connection lost.</span>
          <button className={styles.reconnectButton} onClick={connect}>
            Reconnect
          </button>
        </div>
      )}
      {connState === "error" && (
        <div className={styles.terminalOverlay} data-testid="terminal-error">
          <span>Failed to connect.</span>
          <button className={styles.reconnectButton} onClick={connect}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
