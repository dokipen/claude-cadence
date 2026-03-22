import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import type { Ticket } from "../types";
import type { AgentSession } from "../hooks/useAllSessions";
import { PriorityBadge } from "./PriorityBadge";
import { LabelBadge } from "./LabelBadge";
import { LaunchAgentDialog } from "./LaunchAgentDialog";
import { getLaunchConfig } from "./launchConfig";
import styles from "../styles/card.module.css";
import agentStyles from "../styles/agents.module.css";

export function TicketCard({
  ticket,
  repoUrl,
  activeSession,
}: {
  ticket: Ticket;
  repoUrl?: string;
  activeSession?: AgentSession;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();

  const launchButtonLabel = getLaunchConfig(ticket.state).buttonLabel;

  const handleLaunchClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDialogOpen(true);
    },
    [],
  );

  const handleAgentClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      navigate("/agents");
    },
    [navigate],
  );

  return (
    <>
      <Link to={`/ticket/${ticket.id}`} className={styles.cardLink} data-testid="ticket-card">
        <div className={styles.cardNumber} data-testid="card-number">#{ticket.number}</div>
        <div className={styles.cardTitle} data-testid="card-title">{ticket.title}</div>
        <div className={styles.cardMeta}>
          <PriorityBadge priority={ticket.priority} />
          {ticket.labels.map((label) => (
            <LabelBadge key={label.id} label={label} />
          ))}
          {ticket.blockedBy.some((b) => b.state !== "CLOSED") && (
            <span className={styles.blockedBadge} data-testid="blocked-badge">
              Blocked
            </span>
          )}
        </div>
        <div className={styles.cardFooter}>
          {ticket.assignee && (
            <span className={styles.assignee} data-testid="assignee">
              {ticket.assignee.avatarUrl?.startsWith("https://") ? (
                <img
                  src={ticket.assignee.avatarUrl}
                  alt={ticket.assignee.login}
                  className={styles.avatar}
                />
              ) : (
                <span className={styles.avatarFallback}>
                  {ticket.assignee.login[0].toUpperCase()}
                </span>
              )}
              <span className={styles.assigneeLogin}>{ticket.assignee.login}</span>
            </span>
          )}
          <span className={styles.cardActions}>
            {activeSession && (
              <button
                className={styles.agentRunningButton}
                onClick={handleAgentClick}
                title={activeSession.agentName}
                data-testid="agent-running-indicator"
              >
                <span className={styles.agentRunningDot} />
              </button>
            )}
            <button
              className={agentStyles.cardLaunchButton}
              onClick={handleLaunchClick}
              data-testid="card-launch-button"
            >
              {launchButtonLabel}
            </button>
            {ticket.storyPoints != null && (
              <span className={styles.storyPoints} data-testid="story-points">
                {ticket.storyPoints}
              </span>
            )}
          </span>
        </div>
      </Link>
      <LaunchAgentDialog
        ticketId={ticket.id}
        ticketNumber={ticket.number}
        ticketState={ticket.state}
        ticketTitle={ticket.title}
        repoUrl={repoUrl}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
