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

  const updateCoords = useCallback(() => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const margin = 8;
      // Compute max achievable width in each direction, then pick the roomier side
      const maxWidthRight = Math.min(600, window.innerWidth - rect.left - margin);
      const maxWidthLeft = Math.min(600, rect.right - margin);
      let left: number, width: number;
      if (maxWidthRight >= maxWidthLeft) {
        // Enough space to the right — center below icon, clamp to viewport
        width = maxWidthRight;
        const tooltipLeft = rect.left + rect.width / 2 - width / 2;
        left = Math.max(margin, Math.min(tooltipLeft, window.innerWidth - width - margin));
      } else {
        // Near the right edge (e.g. "close" lane) — anchor to bottom-left of icon
        width = maxWidthLeft;
        left = Math.max(margin, rect.right - width);
      }
      const centerY = rect.top + rect.height / 2;
      let top: number, height: number;

      if (centerY > window.innerHeight / 2) {
        // Lower half — position ABOVE
        const bottom = rect.top - 4;
        top = margin;
        height = bottom - top;
      } else {
        // Upper half — position BELOW
        top = rect.bottom + 4;
        height = window.innerHeight - top - margin;
      }

      setCoords({ top, left, width, height });
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    updateCoords();
    setVisible(true);
  }, [updateCoords]);

  const handleMouseLeave = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    window.addEventListener("resize", updateCoords);
    return () => {
      window.removeEventListener("resize", updateCoords);
    };
  }, [visible, updateCoords]);

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
      // Null handlers before close so stale callbacks don't fire if the socket
      // is still in CONNECTING state when the tooltip hides.
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
