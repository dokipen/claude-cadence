import { useState, useEffect, useCallback } from "react";
import type { TicketDetail } from "../types";
import { getClient } from "../api/client";
import { TICKET_DETAIL_QUERY } from "../api/queries";
import { useAuth } from "../auth/AuthContext";

interface TicketDetailResponse {
  ticket: TicketDetail;
}

interface UseTicketResult {
  ticket: TicketDetail | null;
  loading: boolean;
  error: string | null;
}

const MAX_CONSECUTIVE_FAILURES = 3;

export function useTicket(id: string | undefined): UseTicketResult {
  const { logout } = useAuth();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleAuthFailure = useCallback(() => {
    logout();
  }, [logout]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let isInitialFetch = true;
    let consecutiveFailures = 0;

    const fetchTicket = () => {
      if (isInitialFetch) {
        setLoading(true);
        setError(null);
      }

      const client = getClient(handleAuthFailure);
      client
        .request<TicketDetailResponse>(TICKET_DETAIL_QUERY, { id })
        .then((result) => {
          if (!cancelled) {
            setTicket(result.ticket);
            consecutiveFailures = 0;
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              setError(
                err instanceof Error ? err.message : "Failed to load ticket",
              );
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

    fetchTicket();

    const interval = setInterval(fetchTicket, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, handleAuthFailure]);

  return { ticket, loading, error };
}
