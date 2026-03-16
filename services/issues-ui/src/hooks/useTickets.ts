import { useCallback, useMemo } from "react";
import type { Ticket, TicketState, Priority } from "../types";
import { BOARD_TICKETS_QUERY } from "../api/queries";
import { usePollingQuery } from "./usePollingQuery";

interface TicketEdge {
  node: Ticket;
}

interface TicketsResponse {
  tickets: {
    edges: TicketEdge[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

interface UseTicketsResult {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
}

export interface TicketFilters {
  labelName?: string;
  isBlocked?: boolean;
  priority?: Priority;
}

const transformTickets = (result: TicketsResponse): Ticket[] =>
  result.tickets.edges.map((e) => e.node);

export function useTickets(
  state: TicketState,
  projectId: string | null,
  first: number,
  filters?: TicketFilters,
): UseTicketsResult {
  const labelName = filters?.labelName;
  const isBlocked = filters?.isBlocked;
  const priority = filters?.priority;

  const variables = useMemo(
    () =>
      projectId
        ? {
            state,
            projectId,
            first,
            labelName: labelName || undefined,
            isBlocked,
            priority: priority || undefined,
          }
        : null,
    [state, projectId, first, labelName, isBlocked, priority],
  );

  const { data, loading, error } = usePollingQuery<TicketsResponse, Ticket[]>({
    query: BOARD_TICKETS_QUERY,
    variables,
    transform: transformTickets,
    initialData: [],
    errorMessage: "Failed to load tickets",
  });

  return { tickets: data, loading, error };
}
