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

const MAX_CONSECUTIVE_FAILURES = 3;

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

    let cancelled = false;
    let isInitialFetch = true;
    let consecutiveFailures = 0;

    const fetchTickets = () => {
      if (isInitialFetch) {
        setLoading(true);
        setError(null);
      }

      const client = getClient(handleAuthFailure);
      client
        .request<TicketsResponse>(BOARD_TICKETS_QUERY, {
          state,
          projectId,
          first,
        })
        .then((result) => {
          if (!cancelled) {
            setTickets(result.tickets.edges.map((e) => e.node));
            consecutiveFailures = 0;
            setError(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            consecutiveFailures++;
            if (isInitialFetch || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              setError("Failed to load tickets");
            }
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            isInitialFetch = false;
          }
        });
    };

    fetchTickets();

    const interval = setInterval(fetchTickets, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state, projectId, first, handleAuthFailure]);

  return { tickets, loading, error };
}
