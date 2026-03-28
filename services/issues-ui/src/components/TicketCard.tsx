import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router";
import type { Ticket } from "../types";
import { PriorityBadge } from "./PriorityBadge";
import { LabelBadge } from "./LabelBadge";
import { LaunchAgentDialog } from "./LaunchAgentDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { getLaunchConfig } from "./launchConfig";
import { useTransitionTicket } from "../hooks/useTransitionTicket";
import type { ActiveSessionInfo } from "../types";
import styles from "../styles/card.module.css";
import agentStyles from "../styles/agents.module.css";
import { AnimatedCadenceIcon } from "./AnimatedCadenceIcon";
import { SessionOutputTooltip } from "./SessionOutputTooltip";

export function hasActiveSession(sessions: ActiveSessionInfo[], ticketNumber: number, projectId?: string): ActiveSessionInfo | null {
  const prefix = projectId ? `${projectId}-` : "";
  const prefixes = [`${prefix}lead-${ticketNumber}`, `${prefix}refine-${ticketNumber}`, `${prefix}discuss-${ticketNumber}`];
  return sessions.find(
    (s) => prefixes.includes(s.name) && (s.state === "running" || s.state === "creating" || s.state === "destroying")
  ) ?? null;
}

export function TicketCard({
  ticket,
  repoUrl,
  sessions,
  projectId,
}: {
  ticket: Ticket;
  repoUrl?: string;
  sessions?: ActiveSessionInfo[];
  projectId?: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | undefined>(undefined);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  const navigate = useNavigate();
  const { transition, error: transitionError } = useTransitionTicket();

  const launchButtonLabel = getLaunchConfig(ticket.state).buttonLabel;
  const canClose = ticket.state === "BACKLOG" || ticket.state === "REFINED";

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
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setAnchorRect(rect);
      setDialogOpen(true);
    },
    [],
  );

  const handleCloseClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setConfirmCloseOpen(true);
    },
    [],
  );

  const handleConfirmClose = useCallback(async () => {
    setConfirmCloseOpen(false);
    try {
      await transition(ticket.id, "CLOSED");
      setClosed(true);
    } catch {
      // error is tracked in the hook; card remains visible
    }
  }, [transition, ticket.id]);

  const handleCancelClose = useCallback(() => {
    setConfirmCloseOpen(false);
  }, []);

  const activeSession = hasActiveSession(sessions ?? [], ticket.number, projectId);

  if (closed) return null;

  return (
    <>
      <div className={styles.cardWrapper} data-testid="ticket-card">
        <Link to={`/ticket/${ticket.id}`} className={styles.cardLink}>
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
          </div>
        </Link>
        <div className={styles.cardActionsOverlay}>
          {canClose && (
            <button
              type="button"
              className={styles.cardCloseButton}
              onClick={handleCloseClick}
              aria-label="Close ticket"
              data-testid="card-close-button"
            >
              &times;
            </button>
          )}
          {activeSession ? (
            <button
              type="button"
              className={styles.activeSessionLogo}
              data-testid="active-session-logo"
              aria-label="Session in progress"
              onClick={handleActiveSessionClick}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
            >
              {activeSession.sessionId && activeSession.agentName ? (
                <SessionOutputTooltip session={activeSession}>
                  <AnimatedCadenceIcon />
                </SessionOutputTooltip>
              ) : (
                <AnimatedCadenceIcon />
              )}
            </button>
          ) : (
            <button
              type="button"
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
        </div>
        {transitionError && (
          <div className={styles.cardError} data-testid="card-close-error">
            Failed to close
          </div>
        )}
      </div>
      <LaunchAgentDialog
        ticketNumber={ticket.number}
        ticketState={ticket.state}
        ticketTitle={ticket.title}
        repoUrl={repoUrl}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        anchorRect={anchorRect}
        projectId={projectId}
      />
      <ConfirmDialog
        open={confirmCloseOpen}
        title="Close ticket?"
        message={`Close #${ticket.number} — ${ticket.title}?`}
        confirmLabel="Close ticket"
        onConfirm={handleConfirmClose}
        onCancel={handleCancelClose}
      />
    </>
  );
}
