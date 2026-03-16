import { useState, useEffect, useCallback } from "react";
import type { Ticket, TicketState, Priority } from "../types";
import { getClient } from "../api/client";
import { BOARD_TICKETS_QUERY } from "../api/queries";
import { useAuth } from "../auth/AuthContext";

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

export function useTickets(
  state: TicketState,
  projectId: string | null,
  first: number,
  filters?: TicketFilters,
): UseTicketsResult {
  const { logout } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleAuthFailure = useCallback(() => {
    logout();
  }, [logout]);

  // Stabilize filter values for the dependency array
  const labelName = filters?.labelName;
  const isBlocked = filters?.isBlocked;
  const priority = filters?.priority;

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchTickets = () => {
      const client = getClient(handleAuthFailure);
      client
        .request<TicketsResponse>(BOARD_TICKETS_QUERY, {
          state,
          projectId,
          first,
          labelName: labelName || undefined,
          isBlocked,
          priority: priority || undefined,
        })
        .then((result) => {
          if (!cancelled) setTickets(result.tickets.edges.map((e) => e.node));
        })
        .catch((err) => {
          if (!cancelled)
            setError(
              err instanceof Error ? err.message : "Failed to load tickets",
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    setLoading(true);
    setError(null);
    fetchTickets();

    const interval = setInterval(fetchTickets, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state, projectId, first, labelName, isBlocked, priority, handleAuthFailure]);

  return { tickets, loading, error };
}
