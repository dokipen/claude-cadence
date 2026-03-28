import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ActiveSessionInfo } from "../types";
import styles from "../styles/session-output-tooltip.module.css";

interface SessionOutputTooltipProps {
  session: ActiveSessionInfo;
  children: React.ReactNode;
}

const CMD_RESIZE = "1";

function buildWsUrl(agentName: string, sessionId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/terminal/${encodeURIComponent(agentName)}/${encodeURIComponent(sessionId)}`;
}

export function SessionOutputTooltip({ session, children }: SessionOutputTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const margin = 8;
      const width = Math.min(600, window.innerWidth - rect.left - margin);
      const tooltipLeft = rect.left + rect.width / 2 - width / 2;
      const left = Math.max(margin, Math.min(tooltipLeft, window.innerWidth - width - margin));
      const top = rect.bottom + 4;
      const height = window.innerHeight - top - margin;
      setCoords({ top, left, width, height });
    }
    setVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setVisible(false);
  }, []);

  // Mount xterm and connect WebSocket when tooltip becomes visible
  useEffect(() => {
    if (!visible || !session.agentName || !session.sessionId) return;

    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      disableStdin: true,
      cursorBlink: false,
      scrollback: 500,
      fontSize: 11,
      fontFamily: "monospace",
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    const url = buildWsUrl(session.agentName, session.sessionId);
    const ws = new WebSocket(url, ["tty"]);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      fit.fit();
      ws.send(CMD_RESIZE + JSON.stringify({ columns: term.cols, rows: term.rows }));
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const view = new Uint8Array(ev.data);
        if (view.length < 1) return;
        if (view[0] === 0x30) {
          term.write(view.slice(1));
        }
      } else if (typeof ev.data === "string") {
        if (ev.data.length < 1) return;
        if (ev.data[0] === "0") {
          term.write(ev.data.slice(1));
        }
      }
    };

    return () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
      term.dispose();
    };
  }, [visible, session.agentName, session.sessionId]);

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible && createPortal(
        <div
          className={styles.tooltip}
          data-testid="session-output-tooltip"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
            height: coords.height,
          }}
        >
          <div
            ref={containerRef}
            className={styles.terminal}
            data-testid="session-output-content"
          />
        </div>,
        document.body
      )}
    </div>
  );
}
