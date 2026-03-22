import type { Ticket, TicketState, ActiveSessionInfo } from "../types";
import { TicketCard } from "./TicketCard";
import styles from "../styles/board.module.css";

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
}

export function KanbanColumn({ state, tickets, totalCount, hasNextPage, loading, error, repoUrl, sessions }: KanbanColumnProps) {
  const displayCount = loading
    ? "…"
    : hasNextPage
      ? `${tickets.length} of ${totalCount}`
      : String(tickets.length);

  return (
    <div className={styles.column} data-testid={`column-${state}`}>
      <div className={styles.columnHeader}>
        <span className={styles.columnTitle}>{STATE_LABELS[state]}</span>
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
            <TicketCard key={ticket.id} ticket={ticket} repoUrl={repoUrl} sessions={sessions} />
          ))}
      </div>
    </div>
  );
}
