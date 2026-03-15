import { gql } from "graphql-request";
import { getClient } from "./client.js";

const GET_TICKET_ID_BY_NUMBER = gql`
  query GetTicketIdByNumber($projectId: ID!, $number: Int!) {
    ticketByNumber(projectId: $projectId, number: $number) {
      id
    }
  }
`;

/**
 * Resolves a ticket identifier to a CUID.
 * If the identifier is numeric, requires --project and looks up via ticketByNumber.
 * If the identifier is already a CUID, returns it directly.
 */
export async function resolveTicketId(
  id: string,
  project?: string,
): Promise<string> {
  const isNumber = /^\d+$/.test(id);

  if (!isNumber) {
    return id;
  }

  if (!project) {
    throw new Error("--project is required when using a ticket number");
  }

  const client = getClient();
  const data = await client.request<{
    ticketByNumber: { id: string } | null;
  }>(GET_TICKET_ID_BY_NUMBER, {
    projectId: project,
    number: parseInt(id, 10),
  });

  if (!data.ticketByNumber) {
    throw new Error(`Ticket not found: ${id}`);
  }

  return data.ticketByNumber.id;
}
