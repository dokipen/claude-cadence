import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Ticket, TicketState, ActiveSessionInfo } from "../types";
import { TicketCard } from "./TicketCard";
import { RefineAllDialog } from "./RefineAllDialog";
import { LeadAllDialog } from "./LeadAllDialog";
import { CreateTicketDialog } from "./CreateTicketDialog";
import { AnimatedCadenceIcon } from "./AnimatedCadenceIcon";
import styles from "../styles/board.module.css";

export function hasActiveRefineAllSession(sessions: ActiveSessionInfo[], projectId?: string): boolean {
  const prefix = projectId ? `${projectId}-refine-all-` : "refine-all-";
  return sessions.some(
    (s) => s.name.startsWith(prefix) && (s.state === "running" || s.state === "creating" || s.state === "destroying")
  );
}

export function hasActiveLeadAllSession(sessions: ActiveSessionInfo[], projectId?: string): boolean {
  const prefix = projectId ? `${projectId}-lead-all-` : "lead-all-";
  return sessions.some(
    (s) => s.name.startsWith(prefix) && (s.state === "running" || s.state === "creating" || s.state === "destroying")
  );
}

const STATE_LABELS: Record<TicketState, string> = {
  BACKLOG: "Backlog",
  REFINED: "Refined",
  IN_PROGRESS: "In Progress",
  CLOSED: "Closed",
};

interface KanbanColumnProps {
  state: TicketState;
  tickets: Ticket[];
  totalCount: number;
  hasNextPage: boolean;
  loading: boolean;
  error: string | null;
  repoUrl?: string;
  sessions?: ActiveSessionInfo[];
  projectId?: string;
}

export function KanbanColumn({ state, tickets, totalCount, hasNextPage, loading, error, repoUrl, sessions, projectId }: KanbanColumnProps) {
  const [showRefineAll, setShowRefineAll] = useState(false);
  const [showLeadAll, setShowLeadAll] = useState(false);
  const [showCreateTicket, setShowCreateTicket] = useState(false);

  const displayCount = loading
    ? "…"
    : hasNextPage
      ? `${tickets.length} of ${totalCount}`
      : String(tickets.length);

  return (
    <>
    <div className={styles.column} data-testid={`column-${state}`}>
      <div className={styles.columnHeader}>
        <span className={styles.columnTitle}>{STATE_LABELS[state]}</span>
        {state === "BACKLOG" && (
          <button
            className={styles.createTicketButton}
            onClick={() => setShowCreateTicket(true)}
            data-testid="create-ticket-button"
            title="Create ticket"
          >
            +
          </button>
        )}
        {state === "BACKLOG" && tickets.length > 0 && !loading && !hasNextPage && (
          <button
            className={styles.refineAllButton}
            onClick={() => setShowRefineAll(true)}
            data-testid="refine-all-button"
            aria-label="Refine All"
            title="Refine All"
          >
            {hasActiveRefineAllSession(sessions ?? [], projectId) ? (
              <AnimatedCadenceIcon width={14} height={14} />
            ) : (
              <Sparkles size={14} />
            )}
          </button>
        )}
        {state === "REFINED" && tickets.length > 0 && !loading && !hasNextPage && (
          <button
            className={styles.refineAllButton}
            onClick={() => setShowLeadAll(true)}
            data-testid="lead-all-button"
            aria-label="Lead All"
            title="Lead All"
          >
            {hasActiveLeadAllSession(sessions ?? [], projectId) ? (
              <AnimatedCadenceIcon width={14} height={14} />
            ) : (
              <Sparkles size={14} />
            )}
          </button>
        )}
        <span className={styles.columnCount} data-testid={`count-${state}`}>
          {displayCount}
        </span>
      </div>
      <div className={styles.columnBody}>
        {loading && (
          <div className={styles.loading}>
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </div>
        )}
        {error && <p className={styles.error}>Failed to load tickets</p>}
        {!loading && !error && tickets.length === 0 && (
          <p className={styles.empty} data-testid={`empty-${state}`}>
            No tickets
          </p>
        )}
        {!loading &&
          !error &&
          tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} repoUrl={repoUrl} sessions={sessions} projectId={projectId} />
          ))}
      </div>
    </div>
    {state === "BACKLOG" && (
      <RefineAllDialog
        repoUrl={repoUrl}
        open={showRefineAll}
        onClose={() => setShowRefineAll(false)}
        projectId={projectId}
      />
    )}
    {state === "REFINED" && (
      <LeadAllDialog
        repoUrl={repoUrl}
        open={showLeadAll}
        onClose={() => setShowLeadAll(false)}
        projectId={projectId}
        tickets={tickets}
      />
    )}
    {state === "BACKLOG" && (
      <CreateTicketDialog
        repoUrl={repoUrl}
        open={showCreateTicket}
        onClose={() => setShowCreateTicket(false)}
        projectId={projectId}
      />
    )}
    </>
  );
}
