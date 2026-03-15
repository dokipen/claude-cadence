import { gql } from "graphql-request";
import { getClient } from "./client.js";
import { resolveProjectId } from "./project-resolver.js";

const GET_TICKET_ID_BY_NUMBER = gql`
  query GetTicketIdByNumber($projectId: ID!, $number: Int!) {
    ticketByNumber(projectId: $projectId, number: $number) {
      id
    }
  }
`;

/**
 * Resolves a ticket identifier to a CUID.
 * If the identifier is numeric, resolves the project (via explicit flag, name
 * lookup, or git origin inference) and looks up via ticketByNumber.
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

  const projectId = await resolveProjectId(project);

  const client = getClient();
  const data = await client.request<{
    ticketByNumber: { id: string } | null;
  }>(GET_TICKET_ID_BY_NUMBER, {
    projectId,
    number: parseInt(id, 10),
  });

  if (!data.ticketByNumber) {
    throw new Error(`Ticket not found: ${id}`);
  }

  return data.ticketByNumber.id;
}
