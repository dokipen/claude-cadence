import type { TicketState } from "../types";
import { useTickets } from "../hooks/useTickets";
import type { TicketFilters } from "../hooks/useTickets";
import { KanbanColumn } from "./KanbanColumn";
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
}: {
  state: TicketState;
  projectId: string;
  first: number;
  filters?: TicketFilters;
}) {
  const { tickets, loading, error } = useTickets(state, projectId, first, filters);
  return <KanbanColumn state={state} tickets={tickets} loading={loading} error={error} />;
}

export function KanbanBoard({
  projectId,
  filters,
}: {
  projectId: string | null;
  filters?: TicketFilters;
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
        <ColumnFetcher key={state} state={state} projectId={projectId} first={first} filters={filters} />
      ))}
    </div>
  );
}
