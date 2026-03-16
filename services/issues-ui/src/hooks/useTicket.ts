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

    setLoading(true);
    setError(null);

    const client = getClient(handleAuthFailure);
    client
      .request<TicketDetailResponse>(TICKET_DETAIL_QUERY, { id })
      .then((result) => {
        setTicket(result.ticket);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load ticket");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id, handleAuthFailure]);

  return { ticket, loading, error };
}
