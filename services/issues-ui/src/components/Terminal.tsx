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

    // Manual connect resets retry counter; auto-retry preserves it
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
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#e6edf3",
        selectionBackground: "rgba(56, 89, 182, 0.4)",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39d353",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d364",
        brightWhite: "#f0f6fc",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const url = buildWsUrl(agentName, sessionId);
    // Request the "tty" subprotocol required by ttyd.
    const ws = new WebSocket(url, ["tty"]);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      everConnectedRef.current = true;
      retryCountRef.current = 0;
      setConnState("connected");

      // Send initial handshake: JSON with terminal dimensions.
      const { cols, rows } = term;
      const handshake = JSON.stringify({ columns: cols, rows });
      ws.send(handshake);

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

  // Handle resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      fitRef.current?.fit();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.terminalWrapper} data-testid="terminal-wrapper">
      <div
        ref={containerRef}
        className={styles.terminalContainer}
        data-testid="terminal-container"
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
