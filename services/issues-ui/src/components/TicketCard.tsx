import { useState, useCallback } from "react";
import { Archive, StopCircle, LogIn } from "lucide-react";
import { Link, useNavigate } from "react-router";
import type { Ticket } from "../types";
import { PriorityBadge } from "./PriorityBadge";
import { LabelBadge } from "./LabelBadge";
import { LaunchAgentDialog } from "./LaunchAgentDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { getLaunchConfig } from "./launchConfig";
import { useTransitionTicket } from "../hooks/useTransitionTicket";
import { useSessionsContext } from "../hooks/SessionsContext";
import type { ActiveSessionInfo } from "../types";
import styles from "../styles/card.module.css";
import agentStyles from "../styles/agents.module.css";
import { AnimatedCadenceIcon } from "./AnimatedCadenceIcon";
import { SessionOutputTooltip } from "./SessionOutputTooltip";
import { validateAgentProfile, validateSessionId } from "../utils/validateSession";
import { HubError, deleteSession } from "../api/agentHubClient";

export function hasActiveSession(sessions: ActiveSessionInfo[], ticketNumber: number, projectId?: string): ActiveSessionInfo | null {
  const prefix = projectId ? `${projectId}-` : "";
  const prefixes = [`${prefix}lead-${ticketNumber}`, `${prefix}refine-${ticketNumber}`, `${prefix}discuss-${ticketNumber}`];
  return sessions.find(
    (s) => prefixes.includes(s.name) && (s.state === "running" || s.state === "creating" || s.state === "destroying")
  ) ?? null;
}

export function getActiveSessions(sessions: ActiveSessionInfo[], ticketNumber: number, projectId?: string): ActiveSessionInfo[] {
  const prefix = projectId ? `${projectId}-` : "";
  const prefixes = [`${prefix}lead-${ticketNumber}`, `${prefix}refine-${ticketNumber}`, `${prefix}discuss-${ticketNumber}`];
  return sessions.filter(
    (s) => prefixes.includes(s.name) && (s.state === "running" || s.state === "creating" || s.state === "destroying")
  );
}

export function TicketCard({
  ticket,
  repoUrl,
  sessions,
  projectId,
  activeRefineAll,
}: {
  ticket: Ticket;
  repoUrl?: string;
  sessions?: ActiveSessionInfo[];
  projectId?: string;
  activeRefineAll?: ActiveSessionInfo | null;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | undefined>(undefined);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [closeAnchorRect, setCloseAnchorRect] = useState<DOMRect | undefined>(undefined);
  const [closed, setClosed] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [killAnchorRect, setKillAnchorRect] = useState<DOMRect | undefined>(undefined);
  const [killing, setKilling] = useState(false);
  const [killError, setKillError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { transition, error: transitionError } = useTransitionTicket();
  const { optimisticSetDestroying, optimisticResetState } = useSessionsContext();

  const launchButtonLabel = getLaunchConfig(ticket.state).buttonLabel;
  const canClose = ticket.state === "BACKLOG" || ticket.state === "REFINED";

  const activeSession = hasActiveSession(sessions ?? [], ticket.number, projectId);

  const handleEnterSession = useCallback(() => {
    if (
      activeSession?.agentName &&
      activeSession?.sessionId &&
      validateAgentProfile(activeSession.agentName) &&
      validateSessionId(activeSession.sessionId)
    ) {
      navigate(`/agents?session=${activeSession.agentName}:${activeSession.sessionId}`);
    } else {
      navigate(`/ticket/${ticket.id}`);
    }
  }, [navigate, ticket.id, activeSession]);

  const handleActiveSessionClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleEnterSession();
    },
    [handleEnterSession],
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
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setCloseAnchorRect(rect);
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

  const handleKillClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeSession?.agentName || !activeSession?.sessionId) return;
    try {
      validateAgentProfile(activeSession.agentName);
      validateSessionId(activeSession.sessionId);
    } catch (err) {
      console.warn("Kill session: invalid session data", err);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setKillAnchorRect(rect);
    setKillError(null);
    setShowKillConfirm(true);
  }, [activeSession]);

  const handleConfirmKill = useCallback(async () => {
    if (killing) return;
    if (!activeSession) return;
    const { agentName, sessionId, state: originalState } = activeSession;
    if (!agentName || !sessionId) return;
    setShowKillConfirm(false);
    setKilling(true);
    setKillError(null);
    optimisticSetDestroying(sessionId);
    try {
      await deleteSession(agentName, sessionId);
    } catch (err) {
      optimisticResetState(sessionId, originalState);
      setKillError(err instanceof HubError ? err.message : "Failed to kill session");
    } finally {
      setKilling(false);
    }
  }, [killing, activeSession, optimisticSetDestroying, optimisticResetState]);

  const handleCancelKill = useCallback(() => {
    setShowKillConfirm(false);
  }, []);

  if (closed) return null;

  return (
    <>
      <div
        className={styles.cardWrapper}
        data-testid="ticket-card"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" && activeSession) {
            e.preventDefault();
            handleEnterSession();
          }
        }}
      >
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
        </Link>
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
          <div className={styles.cardActionsOverlay}>
            {canClose && (
              <button
                type="button"
                className={styles.cardCloseButton}
                onClick={handleCloseClick}
                aria-label="Close ticket"
                title="Close ticket"
                data-testid="card-close-button"
              >
                <Archive size={14} />
              </button>
            )}
            {activeSession ? (
              <>
                {activeSession.state !== "destroying" && (
                  <button
                    type="button"
                    className={styles.sessionKillButton}
                    data-testid="session-kill-button"
                    aria-label="Stop session"
                    title="Stop session"
                    onClick={handleKillClick}
                    disabled={killing}
                  >
                    <StopCircle size={14} />
                  </button>
                )}
                {activeSession.state !== "destroying" && (
                  <button
                    type="button"
                    className={styles.enterSessionButton}
                    data-testid="enter-session-button"
                    aria-label="Enter session"
                    title="Enter session"
                    onClick={handleActiveSessionClick}
                  >
                    <LogIn size={14} />
                  </button>
                )}
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
              </>
            ) : activeRefineAll ? (
              // Refine All is a batch operation — not specific to this card, so no navigation on click.
              <div
                className={styles.activeSessionLogo}
                data-testid="active-session-logo"
                aria-label="Refine All in progress"
              >
                {activeRefineAll.sessionId && activeRefineAll.agentName &&
                  validateSessionId(activeRefineAll.sessionId) &&
                  validateAgentProfile(activeRefineAll.agentName) ? (
                  <SessionOutputTooltip session={activeRefineAll}>
                    <AnimatedCadenceIcon />
                  </SessionOutputTooltip>
                ) : (
                  <AnimatedCadenceIcon />
                )}
              </div>
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
        </div>
        {transitionError && (
          <div className={styles.cardError} data-testid="card-close-error">
            Failed to close
          </div>
        )}
        {killError && (
          <div className={styles.cardError} data-testid="card-kill-error">
            {killError}
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
        anchorRect={closeAnchorRect}
      />
      <ConfirmDialog
        open={showKillConfirm}
        title="Stop session?"
        message="Stop session? This will terminate the agent immediately."
        confirmLabel="Stop session"
        onConfirm={handleConfirmKill}
        onCancel={handleCancelKill}
        anchorRect={killAnchorRect}
      />
    </>
  );
}
