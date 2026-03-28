import { useCallback } from "react";
import { Terminal } from "./Terminal";
import { hubFetch, HubError, createSession } from "../api/agentHubClient";
import { useTicketByNumber } from "../hooks/useTicketByNumber";
import { useSessionsContext } from "../hooks/SessionsContext";
import type { Session } from "../types";
import styles from "../styles/agents.module.css";
import { validateSessionId, validateAgentProfile } from "../utils/validateSession";
import { stripProjectPrefix } from "../utils/sessionName";

interface TerminalWindowProps {
  session: Session;
  agentName: string;
  projectId?: string;
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
  projectId,
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
  const ticketMatch = session.name.match(/(?:^|-)lead-(\d+)$/);
  const ticketNumber = ticketMatch ? Number(ticketMatch[1]) : undefined;
  const { ticket } = useTicketByNumber(projectId, ticketNumber);

  const resumeCallback = useCallback(() => {
    if (!validateSessionId(session.id) || !validateAgentProfile(session.agentProfile)) {
      // Silently refuse: malformed server data is unexpected; no user-facing error
      // since the resume button is only rendered when agentProfile is non-empty and
      // the session record is server-generated.
      console.warn("[TerminalWindow] Refusing to resume session: invalid id or agentProfile");
      return;
    }
    const newSessionName = `resume-${session.id.slice(0, 8)}-${Date.now()}`;
    createSession(agentName, session.agentProfile, newSessionName, [`/resume ${session.id}`]).catch(console.error);
    // Fire-and-forget: destroy the current session after kicking off the resume.
    // Ignore 404 (already gone) and other errors — the new session is the priority.
    hubFetch(
      `/agents/${encodeURIComponent(agentName)}/sessions/${encodeURIComponent(session.id)}?force=true`,
      { method: "DELETE" },
    ).catch((err: unknown) => {
      if (!(err instanceof HubError && err.status === 404)) {
        console.error("[TerminalWindow] Failed to delete session on resume:", err);
      }
    });
  }, [agentName, session.id, session.agentProfile]);
  const handleResumeSession = session.agentProfile ? resumeCallback : undefined;

  const { optimisticSetDestroying, optimisticResetState } = useSessionsContext();

  const handleTerminate = async () => {
    if (!validateSessionId(session.id) || !validateAgentProfile(agentName)) {
      console.warn("[TerminalWindow] Refusing to terminate session: invalid id or agentName");
      return;
    }
    const originalState = session.state;
    optimisticSetDestroying(session.id);
    try {
      await hubFetch(
        `/agents/${encodeURIComponent(agentName)}/sessions/${encodeURIComponent(session.id)}?force=true`,
        { method: "DELETE" },
      );
      onTerminated();
    } catch (err) {
      if (err instanceof HubError && err.status === 404) {
        onTerminated();
      } else {
        // Restore original state so the session isn't stuck amber/disabled
        optimisticResetState(session.id, originalState);
      }
    }
  };

  const title = stripProjectPrefix(session.name);

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
          {title}
          <span className={styles.tileAgent}> on {agentName}</span>
          {ticket ? (
            <a
              href={`/ticket/${ticket.id}`}
              className={styles.tileTicketLink}
              onClick={(e) => e.stopPropagation()}
            >
              {ticket.title}
            </a>
          ) : ticketMatch ? (
            <span className={styles.tileTicketLink}>#{ticketMatch[1]}</span>
          ) : null}
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
        <Terminal agentName={agentName} sessionId={session.id} onResumeSession={handleResumeSession} />
      </div>
    </div>
  );
}
