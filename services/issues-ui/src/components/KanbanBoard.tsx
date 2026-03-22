import type { TicketState } from "../types";
import { useTickets, type TicketFilters } from "../hooks/useTickets";
import { KanbanColumn } from "./KanbanColumn";
import type { AgentSession } from "../hooks/useAllSessions";
import styles from "../styles/board.module.css";

const COLUMNS: { state: TicketState; first: number }[] = [
  { state: "BACKLOG", first: 100 },
  { state: "REFINED", first: 100 },
  { state: "IN_PROGRESS", first: 100 },
  { state: "CLOSED", first: 20 },
];

function ColumnFetcher({
  state,
  projectId,
  first,
  filters,
  repoUrl,
  sessions,
}: {
  state: TicketState;
  projectId: string;
  first: number;
  filters?: TicketFilters;
  repoUrl?: string;
  sessions: AgentSession[];
}) {
  const { tickets, totalCount, hasNextPage, loading, error } = useTickets(state, projectId, first, filters);
  return (
    <KanbanColumn
      state={state}
      tickets={tickets}
      totalCount={totalCount}
      hasNextPage={hasNextPage}
      loading={loading}
      error={error}
      repoUrl={repoUrl}
      sessions={sessions}
    />
  );
}

export function KanbanBoard({
  projectId,
  filters,
  repoUrl,
  sessions = [],
}: {
  projectId: string | null;
  filters?: TicketFilters;
  repoUrl?: string;
  sessions?: AgentSession[];
}) {
  if (!projectId) {
    return (
      <div className={styles.board}>
        <p className={styles.noProject}>Select a project to view the board</p>
      </div>
    );
  }

  return (
    <div className={styles.board} data-testid="kanban-board">
      {COLUMNS.map(({ state, first }) => (
        <ColumnFetcher
          key={state}
          state={state}
          projectId={projectId}
          first={first}
          filters={filters}
          repoUrl={repoUrl}
          sessions={sessions}
        />
      ))}
    </div>
  );
}
