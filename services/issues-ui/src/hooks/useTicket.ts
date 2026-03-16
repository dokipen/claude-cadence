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

    const fetchTicket = () => {
      const client = getClient(handleAuthFailure);
      client
        .request<TicketDetailResponse>(TICKET_DETAIL_QUERY, { id })
        .then((result) => {
          if (!cancelled) setTicket(result.ticket);
        })
        .catch((err) => {
          if (!cancelled)
            setError(
              err instanceof Error ? err.message : "Failed to load ticket",
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    setLoading(true);
    setError(null);
    fetchTicket();

    const interval = setInterval(fetchTicket, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, handleAuthFailure]);

  return { ticket, loading, error };
}
