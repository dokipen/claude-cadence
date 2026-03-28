import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import type { ActiveSessionInfo } from "../types";
import { fetchSessionOutput } from "../api/agentHubClient";
import styles from "../styles/session-output-tooltip.module.css";

interface SessionOutputTooltipProps {
  session: ActiveSessionInfo;
  children: React.ReactNode;
}

// Matches CSS: font-size 11px × line-height 1.4
const LINE_HEIGHT_PX = 11 * 1.4;
// Matches CSS: padding 8px top + 8px bottom
const PADDING_PX = 16;

export function SessionOutputTooltip({ session, children }: SessionOutputTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [output, setOutput] = useState<string | null | undefined>(undefined);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [maxLines, setMaxLines] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const margin = 8;
      const tooltipWidth = Math.min(1200, Math.max(900, window.innerWidth - margin * 2));
      const centered = rect.left + rect.width / 2 - tooltipWidth / 2;
      const left = Math.max(margin, Math.min(centered, window.innerWidth - tooltipWidth - margin));
      setCoords({ top: rect.bottom + 4, left });
      const availableHeight = window.innerHeight - (rect.bottom + 4) - margin;
      setMaxLines(Math.max(1, Math.floor((availableHeight - PADDING_PX) / LINE_HEIGHT_PX)));
    }
    setVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const doFetch = () => {
      if (!session.sessionId || !session.agentName) return;
      fetchSessionOutput(session.agentName, session.sessionId)
        .then((text) => setOutput(text))
        .catch(() => setOutput(null));
    };

    doFetch();

    if (session.state === "running" || session.state === "creating") {
      intervalRef.current = setInterval(doFetch, 2000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible, session.sessionId, session.agentName, session.state]);

  // Reset output when tooltip hides so next open shows Loading...
  useEffect(() => {
    if (!visible) {
      setOutput(undefined);
    }
  }, [visible]);

  const displayOutput = useMemo(() => {
    if (typeof output !== "string" || maxLines <= 0) return output;
    const lines = output.split("\n");
    if (lines.length <= maxLines) return output;
    return lines.slice(-maxLines).join("\n");
  }, [output, maxLines]);

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
          style={{ top: coords.top, left: coords.left }}
        >
          <pre className={styles.output} data-testid="session-output-content">
            {displayOutput === undefined
              ? "Loading..."
              : displayOutput === null
                ? "Output unavailable"
                : displayOutput}
          </pre>
        </div>,
        document.body
      )}
    </div>
  );
}
