import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import type { Ticket } from "../types";
import { PriorityBadge } from "./PriorityBadge";
import { LabelBadge } from "./LabelBadge";
import { LaunchAgentDialog } from "./LaunchAgentDialog";
import { getLaunchConfig } from "./launchConfig";
import type { AgentSession } from "../hooks/useAllSessions";
import styles from "../styles/card.module.css";
import agentStyles from "../styles/agents.module.css";

export function hasActiveSession(sessions: AgentSession[], ticketNumber: number): boolean {
  const prefixes = [`lead-${ticketNumber}`, `refine-${ticketNumber}`, `discuss-${ticketNumber}`];
  return sessions.some(
    (s) => prefixes.includes(s.session.name) && (s.session.state === "running" || s.session.state === "creating" || s.session.state === "destroying")
  );
}

export function TicketCard({
  ticket,
  repoUrl,
  sessions,
}: {
  ticket: Ticket;
  repoUrl?: string;
  sessions?: AgentSession[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();

  const launchButtonLabel = getLaunchConfig(ticket.state).buttonLabel;

  const handleActiveSessionClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      navigate(`/ticket/${ticket.id}?tab=agent`);
    },
    [navigate, ticket.id],
  );

  const handleLaunchClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDialogOpen(true);
    },
    [],
  );

  const activeSession = hasActiveSession(sessions ?? [], ticket.number);

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
            {activeSession ? (
              <button
                type="button"
                className={styles.activeSessionLogo}
                data-testid="active-session-logo"
                aria-label="Session in progress"
                onClick={handleActiveSessionClick}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
              >
                <img src="/cadence-icon-light.svg" alt="" width={18} height={18} className={styles.spinningLogo} />
              </button>
            ) : (
              <button
                className={agentStyles.cardLaunchButton}
                onClick={handleLaunchClick}
                data-testid="card-launch-button"
              >
                {launchButtonLabel}
              </button>
            )}
            {ticket.storyPoints != null && (
              <span className={styles.storyPoints} data-testid="story-points">
                {ticket.storyPoints}
              </span>
            )}
          </span>
        </div>
      </Link>
      <LaunchAgentDialog
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
