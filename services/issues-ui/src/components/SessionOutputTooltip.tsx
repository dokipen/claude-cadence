import { useState, useRef, useEffect, useCallback } from "react";
import type { ActiveSessionInfo } from "../types";
import { fetchSessionOutput } from "../api/agentHubClient";
import styles from "../styles/session-output-tooltip.module.css";

interface SessionOutputTooltipProps {
  session: ActiveSessionInfo;
  children: React.ReactNode;
}

export function SessionOutputTooltip({ session, children }: SessionOutputTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [output, setOutput] = useState<string | null | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleMouseEnter = useCallback(() => {
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

  return (
    <div
      className={styles.wrapper}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible && (
        <div className={styles.tooltip} data-testid="session-output-tooltip">
          <pre className={styles.output} data-testid="session-output-content">
            {output === undefined
              ? "Loading..."
              : output === null
                ? "Output unavailable"
                : output}
          </pre>
        </div>
      )}
    </div>
  );
}
