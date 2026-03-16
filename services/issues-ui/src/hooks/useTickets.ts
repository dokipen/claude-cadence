import { useState, useEffect, useCallback } from "react";
import type { Ticket, TicketState } from "../types";
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

export function useTickets(
  state: TicketState,
  projectId: string | null,
  first: number,
): UseTicketsResult {
  const { logout } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleAuthFailure = useCallback(() => {
    logout();
  }, [logout]);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    const fetchTickets = () => {
      const client = getClient(handleAuthFailure);
      client
        .request<TicketsResponse>(BOARD_TICKETS_QUERY, {
          state,
          projectId,
          first,
        })
        .then((result) => {
          setTickets(result.tickets.edges.map((e) => e.node));
        })
        .catch((err) => {
          setError(
            err instanceof Error ? err.message : "Failed to load tickets",
          );
        })
        .finally(() => {
          setLoading(false);
        });
    };

    setLoading(true);
    setError(null);
    fetchTickets();

    const interval = setInterval(fetchTickets, 60_000);
    return () => clearInterval(interval);
  }, [state, projectId, first, handleAuthFailure]);

  return { tickets, loading, error };
}
