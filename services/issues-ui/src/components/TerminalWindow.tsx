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
  isKeyboardGrabbed?: boolean;
  onHeaderKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  windowIndex?: number;
  windowCount?: number;
  isMaximized?: boolean;
  onMaximize?: () => void;
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
  isKeyboardGrabbed,
  onHeaderKeyDown,
  windowIndex,
  windowCount,
  isMaximized,
  onMaximize,
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

  const title = session.name;

  return (
    <div
      className={`${styles.tileWindow}${isDragOver ? ` ${styles.tileWindowDragOver}` : ""}`}
      data-testid="terminal-window"
      aria-label={`${title} window, position ${(windowIndex ?? 0) + 1} of ${windowCount ?? 1}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={`${styles.tileHeader}${onDragStart ? ` ${styles.tileHeaderDraggable}` : ""}${isKeyboardGrabbed ? ` ${styles.tileHeaderKeyboardGrabbed}` : ""}`}
        data-testid="tile-header"
        draggable={!!onDragStart}
        tabIndex={0}
        role="button"
        aria-pressed={isKeyboardGrabbed ?? false}
        aria-label={isKeyboardGrabbed ? `Moving: ${title}. Use arrow keys to reposition, Space to confirm, Escape to cancel` : `Rearrange window: ${title}. Press Space to start moving.`}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onKeyDown={onHeaderKeyDown}
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
            className={styles.tileMaximize}
            onClick={() => onMaximize?.()}
            data-testid="tile-maximize"
            title={isMaximized ? "Restore" : "Maximize"}
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? "⊡" : "▢"}
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
