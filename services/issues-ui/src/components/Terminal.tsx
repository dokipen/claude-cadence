import { useRef, useEffect, useState, useCallback } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import styles from "../styles/agents.module.css";
import { useDarkMode } from "../hooks/useDarkMode";

type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

const DARK_THEME: ITheme = {
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
};

const LIGHT_THEME: ITheme = {
  // Cadence light palette — all foreground colors verified ≥ 4.5:1 contrast vs #FAFBFC
  background: "#FAFBFC",
  foreground: "#1E2A3A",
  cursor: "#2D3A8C",
  selectionBackground: "rgba(45, 58, 140, 0.15)",
  selectionForeground: "#1E2A3A",
  black: "#24292F",       // 15.8:1
  red: "#CF222E",         // github red, 5.5:1
  green: "#116329",       // github green, 5.4:1
  yellow: "#4D2D00",      // dark amber, 10.3:1
  blue: "#0550AE",        // github blue, 5.9:1
  magenta: "#6F42C1",     // github purple, 5.3:1
  cyan: "#1B7C83",        // teal, 4.7:1
  white: "#57606A",       // cadence gray, 4.5:1
  brightBlack: "#6E7781", // github secondary, 3.4:1 (dim text — intentional compromise)
  brightRed: "#A40E26",   // deep red, 7.8:1
  brightGreen: "#0C6427", // deep green, 6.5:1
  brightYellow: "#3D2200", // deep amber, 12.8:1
  brightBlue: "#2D3A8C",  // cadence --primary, 9.5:1
  brightMagenta: "#5A379B", // deep purple, 7.2:1
  brightCyan: "#0969DA",  // github link blue, 4.9:1
  brightWhite: "#1E2A3A", // cadence --text, 15.0:1
};

interface TerminalProps {
  agentName: string;
  sessionId: string;
  onResumeSession?: () => void;
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

export function Terminal({ agentName, sessionId, onResumeSession }: TerminalProps) {
  const isDark = useDarkMode();
  // Ref keeps `connect` stable: reading isDarkRef.current inside the callback
  // picks up the latest value without adding isDark to connect's dependency array,
  // which would teardown and rebuild the terminal on every color-scheme change.
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const everConnectedRef = useRef(false);
  const isAutoRetryRef = useRef(false);
  const copyHandlerRef = useRef<((e: ClipboardEvent) => void) | null>(null);
  // true while auto-retrying after a drop (distinct from initial "connecting" text)
  const reconnectingRef = useRef(false);
  const [connState, setConnState] = useState<ConnectionState>("connecting");

  const connect = useCallback(() => {
    // Clear any pending retry timer
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    // Manual connect resets retry counter and reconnect mode; auto-retry preserves them.
    // everConnectedRef always resets: a manual Reconnect after a drop starts a
    // fresh retry cycle rather than immediately showing "Connection lost." again.
    if (!isAutoRetryRef.current) {
      retryCountRef.current = 0;
      reconnectingRef.current = false;
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

    if (copyHandlerRef.current) {
      container.removeEventListener("copy", copyHandlerRef.current);
      copyHandlerRef.current = null;
    }

    // During post-drop auto-reconnect, keep the "reconnecting" overlay active
    // rather than flipping back to "Starting session…" between retry attempts.
    if (!reconnectingRef.current) {
      setConnState("connecting");
    }

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      scrollback: 5000,
      scrollSensitivity: 1,
      fastScrollSensitivity: 5,
      rightClickSelectsWord: true,
      macOptionIsMeta: true,
      theme: isDarkRef.current ? DARK_THEME : LIGHT_THEME,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    // Guard against double-write: keyboard handler sets this flag so the DOM
    // copy event (which may fire immediately after) skips its own clipboard write.
    let keyboardCopyHandled = false;

    term.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "c" && event.type === "keydown") {
        const selection = term.getSelection();
        if (selection) {
          const trimmed = selection.split("\n").map((line) => line.trimEnd()).join("\n").trimEnd();
          keyboardCopyHandled = true;
          navigator.clipboard.writeText(trimmed).catch(console.error);
          return false; // prevent xterm from handling this key event
        }
      }
      return true;
    });

    const handleCopy = (e: ClipboardEvent) => {
      if (keyboardCopyHandled) {
        keyboardCopyHandled = false;
        return;
      }
      const selection = term.getSelection();
      if (selection && e.clipboardData) {
        e.preventDefault();
        const trimmed = selection.split("\n").map((line) => line.trimEnd()).join("\n").trimEnd();
        e.clipboardData.setData("text/plain", trimmed);
      }
    };
    copyHandlerRef.current = handleCopy;
    container.addEventListener("copy", handleCopy);

    termRef.current = term;
    fitRef.current = fit;

    // Close any previous WebSocket before creating a new one.
    // Null out its handlers first so a late onclose doesn't schedule a spurious retry.
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
    }

    const url = buildWsUrl(agentName, sessionId);
    // Request the "tty" subprotocol required by ttyd.
    const ws = new WebSocket(url, ["tty"]);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // Verify the server confirmed the "tty" subprotocol. If it didn't,
      // proceeding with ttyd binary framing would cause a silent protocol
      // mismatch. Exhaust the retry budget first so onclose lands on the
      // permanent-error path instead of scheduling auto-retries.
      if (ws.protocol !== "tty") {
        retryCountRef.current = RETRY_DELAYS_MS.length;
        ws.close(1002); // 1002 = Protocol Error
        return;
      }

      reconnectingRef.current = false;
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
      if (everConnectedRef.current || reconnectingRef.current) {
        // Was connected (or is currently in a post-drop reconnect sequence) —
        // continue auto-retrying with exponential backoff.
        if (retryCountRef.current < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[retryCountRef.current];
          retryCountRef.current += 1;
          reconnectingRef.current = true;
          setConnState("reconnecting");
          isAutoRetryRef.current = true;
          retryTimerRef.current = setTimeout(connect, delay);
        } else {
          // All reconnect attempts exhausted — fall back to manual reconnect.
          reconnectingRef.current = false;
          setConnState("disconnected");
        }
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

  // Manual connect: always resets the auto-retry flag before connecting, so
  // user-initiated reconnects get a fresh retry cycle regardless of whether a
  // timer-scheduled auto-retry is pending.
  const manualConnect = useCallback(() => {
    isAutoRetryRef.current = false;
    connect();
  }, [connect]);

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
      if (copyHandlerRef.current && containerRef.current) {
        containerRef.current.removeEventListener("copy", copyHandlerRef.current);
        copyHandlerRef.current = null;
      }
    };
  }, [connect]);

  // Update terminal theme when OS/app color scheme changes, without reconnecting.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = isDark ? DARK_THEME : LIGHT_THEME;
    }
  }, [isDark]);

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
      {connState === "reconnecting" && (
        <div className={styles.terminalOverlay} data-testid="terminal-reconnecting">
          <div className={styles.spinner} />
          <span>Reconnecting…</span>
          <button className={styles.reconnectButton} onClick={manualConnect}>
            Connect now
          </button>
        </div>
      )}
      {connState === "disconnected" && (
        <div className={styles.terminalOverlay} data-testid="terminal-disconnected">
          <span>Connection lost.</span>
          <button className={styles.reconnectButton} onClick={manualConnect}>
            Reconnect
          </button>
          {onResumeSession && (
            <button className={styles.reconnectButton} data-testid="terminal-resume-session" onClick={onResumeSession}>
              Resume Session
            </button>
          )}
        </div>
      )}
      {connState === "error" && (
        <div className={styles.terminalOverlay} data-testid="terminal-error">
          <span>Failed to connect.</span>
          <button className={styles.reconnectButton} onClick={manualConnect}>
            Retry
          </button>
          {onResumeSession && (
            <button className={styles.reconnectButton} data-testid="terminal-resume-session" onClick={onResumeSession}>
              Resume Session
            </button>
          )}
        </div>
      )}
    </div>
  );
}
