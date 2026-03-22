import { useState, useCallback } from "react";
import { getClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { TRANSITION_TICKET_MUTATION } from "../api/queries";
import type { TicketState } from "../types";

interface TransitionResult {
  transitionTicket: {
    id: string;
    state: TicketState;
  };
}

interface UseTransitionTicketResult {
  transition: (id: string, to: TicketState) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useTransitionTicket(): UseTransitionTicketResult {
  const { logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transition = useCallback(
    async (id: string, to: TicketState): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const client = getClient(logout);
        await client.request<TransitionResult>(TRANSITION_TICKET_MUTATION, {
          id,
          to,
        });
      } catch (err) {
        setError("Failed to update ticket");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [logout],
  );

  return { transition, loading, error };
}
