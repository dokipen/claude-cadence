import { Terminal } from "./Terminal";
import { hubFetch } from "../api/agentHubClient";
import type { Session } from "../types";
import styles from "../styles/agents.module.css";

interface TerminalWindowProps {
  session: Session;
  agentName: string;
  onMinimize: () => void;
  onTerminated: () => void;
}

export function TerminalWindow({
  session,
  agentName,
  onMinimize,
  onTerminated,
}: TerminalWindowProps) {
  const ticketMatch = session.name.match(/^lead-(\d+)$/);

  const handleTerminate = async () => {
    try {
      await hubFetch(
        `/agents/${encodeURIComponent(agentName)}/sessions/${encodeURIComponent(session.id)}`,
        { method: "DELETE" },
      );
    } catch {
      // Session may already be gone
    }
    onTerminated();
  };

  return (
    <div className={styles.tileWindow} data-testid="terminal-window">
      <div className={styles.tileHeader} data-testid="tile-header">
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
