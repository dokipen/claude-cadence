import { Terminal } from "./Terminal";
import { hubFetch, HubError } from "../api/agentHubClient";
import type { Session } from "../types";
import styles from "../styles/agents.module.css";

interface TerminalWindowProps {
  session: Session;
  agentName: string;
  onMinimize: () => void;
  onTerminated: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  isDragOver?: boolean;
}

export function TerminalWindow({
  session,
  agentName,
  onMinimize,
  onTerminated,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragOver,
}: TerminalWindowProps) {
  const ticketMatch = session.name.match(/^lead-(\d+)$/);

  const handleTerminate = async () => {
    try {
      await hubFetch(
        `/agents/${encodeURIComponent(agentName)}/sessions/${encodeURIComponent(session.id)}?force=true`,
        { method: "DELETE" },
      );
      onTerminated();
    } catch (err) {
      // 404 means session is already gone — treat as success
      if (err instanceof HubError && err.status === 404) {
        onTerminated();
      }
      // Other errors: leave window in place so user can retry
    }
  };

  return (
    <div
      className={`${styles.tileWindow}${isDragOver ? ` ${styles.tileWindowDragOver}` : ""}`}
      data-testid="terminal-window"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={`${styles.tileHeader} ${styles.tileHeaderDraggable}`}
        data-testid="tile-header"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <span className={styles.tileTitle}>
          {session.name}
          <span className={styles.tileAgent}> on {agentName}</span>
          {ticketMatch && (
            <a
              href={`/ticket/${ticketMatch[1]}`}
              className={styles.tileTicketLink}
              onClick={(e) => e.stopPropagation()}
            >
              #{ticketMatch[1]}
            </a>
          )}
        </span>
        <div className={styles.tileControls}>
          <button
            className={styles.tileMinimize}
            onClick={onMinimize}
            data-testid="tile-minimize"
            title="Minimize"
          >
            —
          </button>
          <button
            className={styles.tileTerminate}
            onClick={handleTerminate}
            data-testid="tile-terminate"
            title="Terminate"
          >
            ×
          </button>
        </div>
      </div>
      <div className={styles.tileBody}>
        <Terminal agentName={agentName} sessionId={session.id} />
      </div>
    </div>
  );
}
