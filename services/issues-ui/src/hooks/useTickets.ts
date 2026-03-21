import { useMemo } from "react";
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
    totalCount: number;
  };
}

interface TransformedTickets {
  tickets: Ticket[];
  totalCount: number;
  hasNextPage: boolean;
}

interface UseTicketsResult {
  tickets: Ticket[];
  totalCount: number;
  hasNextPage: boolean;
  loading: boolean;
  error: string | null;
}

export interface TicketFilters {
  labelName?: string;
  isBlocked?: boolean;
  priority?: Priority;
  excludeLabelName?: string;
  excludePriority?: Priority;
}

const transformTickets = (result: TicketsResponse): TransformedTickets => ({
  tickets: result.tickets.edges.map((e) => e.node),
  totalCount: result.tickets.totalCount,
  hasNextPage: result.tickets.pageInfo.hasNextPage,
});

export function useTickets(
  state: TicketState,
  projectId: string | null,
  first: number,
  filters?: TicketFilters,
): UseTicketsResult {
  const labelName = filters?.labelName;
  const isBlocked = filters?.isBlocked;
  const priority = filters?.priority;
  const excludeLabelName = filters?.excludeLabelName;
  const excludePriority = filters?.excludePriority;

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

  const { data, loading, error } = usePollingQuery<TicketsResponse, TransformedTickets>({
    query: BOARD_TICKETS_QUERY,
    variables,
    transform: transformTickets,
    initialData: { tickets: [], totalCount: 0, hasNextPage: false },
    errorMessage: "Failed to load tickets",
  });

  const tickets = useMemo(() => {
    let result = data.tickets;
    if (excludeLabelName) {
      result = result.filter(
        (ticket) => !ticket.labels.some((label) => label.name === excludeLabelName),
      );
    }
    if (excludePriority) {
      result = result.filter((ticket) => ticket.priority !== excludePriority);
    }
    return result;
  }, [data.tickets, excludeLabelName, excludePriority]);

  return { tickets, totalCount: data.totalCount, hasNextPage: data.hasNextPage, loading, error };
}
