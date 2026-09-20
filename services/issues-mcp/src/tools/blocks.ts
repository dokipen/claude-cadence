import { gql } from "graphql-request";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { getDefaultProjectId } from "../config.js";
import { resolveProjectName } from "../projects.js";

// --- GraphQL Documents ---

const TICKET_ID_BY_NUMBER = gql`
  query TicketIdByNumber($projectId: ID!, $number: Int!) {
    ticketByNumber(projectId: $projectId, number: $number) {
      id
    }
  }
`;

const ADD_BLOCK_RELATION = gql`
  mutation AddBlockRelation($blockerId: ID!, $blockedId: ID!) {
    addBlockRelation(blockerId: $blockerId, blockedId: $blockedId) {
      id
      number
      title
      blockedBy {
        id
        number
        title
        state
      }
      blocks {
        id
        number
        title
        state
      }
    }
  }
`;

const REMOVE_BLOCK_RELATION = gql`
  mutation RemoveBlockRelation($blockerId: ID!, $blockedId: ID!) {
    removeBlockRelation(blockerId: $blockerId, blockedId: $blockedId) {
      id
      number
      title
      blockedBy {
        id
        number
        title
        state
      }
      blocks {
        id
        number
        title
        state
      }
    }
  }
`;

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

export interface BlockParams {
  blockerId?: string;
  blockerNumber?: number | string;
  blockedId?: string;
  blockedNumber?: number | string;
  projectId?: string;
  projectName?: string;
}

/**
 * Resolves a ticket reference (CUID or project-scoped number) to a CUID.
 * Returns a string on success, or a CallToolResult error.
 */
async function resolveTicket(
  role: "blocker" | "blocked",
  id: string | undefined,
  number: number | string | undefined,
  projectId: string | undefined
): Promise<string | CallToolResult> {
  if (id !== undefined && number !== undefined) {
    return err(`Provide ${role}Id OR ${role}Number, not both`);
  }
  if (id !== undefined) {
    if (typeof id !== "string" || id.trim() === "") return err(`${role}Id must be a non-empty string`);
    return id;
  }
  if (number === undefined) {
    return err(`${role}Id or ${role}Number is required`);
  }

  const n = typeof number === "string" && /^\d+$/.test(number.trim()) ? parseInt(number, 10) : number;
  if (typeof n !== "number" || !Number.isInteger(n)) {
    return err(`${role}Number must be an integer, got ${JSON.stringify(number)}`);
  }
  if (!projectId) {
    return err(`projectId or projectName is required when using ${role}Number (or set ISSUES_PROJECT_ID)`);
  }

  const data = await getClient().request<{ ticketByNumber: { id: string } | null }>(
    TICKET_ID_BY_NUMBER,
    { projectId, number: n }
  );
  if (!data.ticketByNumber) {
    return err(`${role === "blocker" ? "Blocker" : "Blocked"} ticket #${n} not found`);
  }
  return data.ticketByNumber.id;
}

async function mutateBlock(
  params: BlockParams,
  document: string,
  field: "addBlockRelation" | "removeBlockRelation"
): Promise<CallToolResult> {
  try {
    let projectId = params.projectId;
    if (projectId === undefined && params.projectName !== undefined) {
      projectId = await resolveProjectName(params.projectName);
    }
    projectId ??= getDefaultProjectId();

    const blockerId = await resolveTicket("blocker", params.blockerId, params.blockerNumber, projectId);
    if (typeof blockerId !== "string") return blockerId;
    const blockedId = await resolveTicket("blocked", params.blockedId, params.blockedNumber, projectId);
    if (typeof blockedId !== "string") return blockedId;

    const data = await getClient().request<Record<string, unknown>>(document, { blockerId, blockedId });
    return ok(data[field]);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

/** Makes the blocker ticket block the blocked ticket. Returns the blocked ticket. */
export function ticketBlockAdd(params: BlockParams): Promise<CallToolResult> {
  return mutateBlock(params, ADD_BLOCK_RELATION, "addBlockRelation");
}

/** Removes the blocking relationship. Returns the blocked ticket. */
export function ticketBlockRemove(params: BlockParams): Promise<CallToolResult> {
  return mutateBlock(params, REMOVE_BLOCK_RELATION, "removeBlockRelation");
}
