import { useMemo } from "react";
import { TICKET_BY_NUMBER_QUERY } from "../api/queries";
import { usePollingQuery } from "./usePollingQuery";

interface TicketSummary {
  id: string;
  number: number;
  title: string;
}

interface TicketByNumberResponse {
  ticketByNumber: TicketSummary | null;
}

interface UseTicketByNumberResult {
  ticket: TicketSummary | null;
  loading: boolean;
  error: string | null;
}

const transformTicket = (result: TicketByNumberResponse): TicketSummary | null =>
  result.ticketByNumber;

export function useTicketByNumber(
  projectId: string | undefined,
  number: number | undefined
): UseTicketByNumberResult {
  const variables = useMemo(
    () =>
      projectId != null && number != null
        ? { projectId, number }
        : null,
    [projectId, number]
  );

  const { data, loading, error } = usePollingQuery<
    TicketByNumberResponse,
    TicketSummary | null
  >({
    query: TICKET_BY_NUMBER_QUERY,
    variables,
    transform: transformTicket,
    initialData: null,
    errorMessage: "Failed to load ticket",
  });

  return { ticket: data, loading, error };
}
