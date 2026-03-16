import { useRef, useEffect, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { AttachAddon } from "@xterm/addon-attach";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import styles from "../styles/agents.module.css";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

interface TerminalProps {
  agentName: string;
  sessionId: string;
}

function buildWsUrl(agentName: string, sessionId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/terminal/${encodeURIComponent(agentName)}/${encodeURIComponent(sessionId)}`;
}

export function Terminal({ agentName, sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connState, setConnState] = useState<ConnectionState>("connecting");

  const connect = useCallback(() => {
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
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const url = buildWsUrl(agentName, sessionId);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      const attach = new AttachAddon(ws);
      term.loadAddon(attach);
      setConnState("connected");
    };

    ws.onerror = () => {
      setConnState("error");
    };

    ws.onclose = () => {
      setConnState((prev) => (prev === "error" ? "error" : "disconnected"));
    };
  }, [agentName, sessionId]);

  // Initial connection
  useEffect(() => {
    connect();

    return () => {
      wsRef.current?.close();
      termRef.current?.dispose();
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
          <span>Connecting to terminal…</span>
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
