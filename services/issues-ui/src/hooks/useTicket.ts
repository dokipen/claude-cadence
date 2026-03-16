import { useMemo } from "react";
import type { TicketDetail } from "../types";
import { TICKET_DETAIL_QUERY } from "../api/queries";
import { usePollingQuery } from "./usePollingQuery";

interface TicketDetailResponse {
  ticket: TicketDetail;
}

interface UseTicketResult {
  ticket: TicketDetail | null;
  loading: boolean;
  error: string | null;
}

const transformTicket = (result: TicketDetailResponse): TicketDetail =>
  result.ticket;

export function useTicket(id: string | undefined): UseTicketResult {
  const variables = useMemo(() => (id ? { id } : null), [id]);

  const { data, loading, error } = usePollingQuery<
    TicketDetailResponse,
    TicketDetail | null
  >({
    query: TICKET_DETAIL_QUERY,
    variables,
    transform: transformTicket,
    initialData: null,
    errorMessage: "Failed to load ticket",
  });

  return { ticket: data, loading, error };
}
