import { gql } from "graphql-request";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { getDefaultProjectId } from "../config.js";
import { resolveProjectName } from "../projects.js";

// --- GraphQL Documents ---

const CREATE_TICKET = gql`
  mutation CreateTicket($input: CreateTicketInput!) {
    createTicket(input: $input) {
      id
      number
      title
      description
      acceptanceCriteria
      state
      priority
      storyPoints
      labels {
        id
        name
        color
      }
      project {
        id
        name
      }
      createdAt
      updatedAt
    }
  }
`;

const GET_TICKET = gql`
  query GetTicket($id: ID!) {
    ticket(id: $id) {
      id
      number
      title
      description
      acceptanceCriteria
      state
      storyPoints
      priority
      assignee {
        id
        login
        displayName
      }
      project {
        id
        name
      }
      labels {
        id
        name
        color
      }
      comments {
        id
        body
        author {
          login
          displayName
        }
        createdAt
      }
      blocks {
        id
        number
        title
        state
      }
      blockedBy {
        id
        number
        title
        state
      }
      createdAt
      updatedAt
    }
  }
`;

const GET_TICKET_BY_NUMBER = gql`
  query GetTicketByNumber($projectId: ID!, $number: Int!) {
    ticketByNumber(projectId: $projectId, number: $number) {
      id
      number
      title
      description
      acceptanceCriteria
      state
      storyPoints
      priority
      assignee {
        id
        login
        displayName
      }
      project {
        id
        name
      }
      labels {
        id
        name
        color
      }
      comments {
        id
        body
        author {
          login
          displayName
        }
        createdAt
      }
      blocks {
        id
        number
        title
        state
      }
      blockedBy {
        id
        number
        title
        state
      }
      createdAt
      updatedAt
    }
  }
`;

const LIST_TICKETS = gql`
  query ListTickets(
    $state: TicketState
    $labelNames: [String!]
    $isBlocked: Boolean
    $priority: Priority
    $projectId: ID
    $first: Int
  ) {
    tickets(
      state: $state
      labelNames: $labelNames
      isBlocked: $isBlocked
      priority: $priority
      projectId: $projectId
      first: $first
    ) {
      edges {
        node {
          id
          number
          title
          description
          acceptanceCriteria
          state
          priority
          storyPoints
          assignee {
            login
            displayName
          }
          project {
            id
            name
          }
          labels {
            id
            name
            color
          }
          blockedBy {
            id
            state
          }
          createdAt
          updatedAt
        }
      }
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const UPDATE_TICKET = gql`
  mutation UpdateTicket($id: ID!, $input: UpdateTicketInput!) {
    updateTicket(id: $id, input: $input) {
      id
      number
      title
      description
      acceptanceCriteria
      state
      storyPoints
      priority
      updatedAt
    }
  }
`;

const TRANSITION_TICKET = gql`
  mutation TransitionTicket($id: ID!, $to: TicketState!) {
    transitionTicket(id: $id, to: $to) {
      id
      number
      title
      state
      priority
      updatedAt
    }
  }
`;

/**
 * Normalizes an array parameter that may arrive as a JSON-encoded string.
 * The MCP framework sometimes serializes array arguments as JSON strings
 * (e.g. '["id1","id2"]') instead of passing them as proper arrays.
 */
function parseStringArray(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof (value as unknown) === "string") {
    try {
      const parsed: unknown = JSON.parse(value as unknown as string);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // not a valid JSON array
    }
  }
  return undefined;
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

async function resolveProjectId(
  projectId: string | undefined,
  projectName: string | undefined
): Promise<string | undefined> {
  if (projectId !== undefined) return projectId;
  if (projectName !== undefined) return resolveProjectName(projectName);
  return getDefaultProjectId();
}

// --- Tool handlers ---

export interface TicketCreateParams {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  labelIds?: string[];
  priority?: string;
  storyPoints?: number;
  projectId?: string;
  projectName?: string;
}

export async function ticketCreate(params: TicketCreateParams): Promise<CallToolResult> {
  try {
    const client = getClient();
    const pid = await resolveProjectId(params.projectId, params.projectName);
    if (!pid) {
      return err("projectId is required (pass it explicitly or set ISSUES_PROJECT_ID)");
    }

    const input: Record<string, unknown> = {
      title: params.title,
      projectId: pid,
    };
    if (params.description !== undefined) input.description = params.description;
    if (params.acceptanceCriteria !== undefined) input.acceptanceCriteria = params.acceptanceCriteria;
    const labelIds = parseStringArray(params.labelIds);
    if (labelIds !== undefined && labelIds.length > 0) input.labelIds = labelIds;
    if (params.priority !== undefined) input.priority = params.priority;
    if (params.storyPoints !== undefined) input.storyPoints = params.storyPoints;

    const data = await client.request<{ createTicket: unknown }>(CREATE_TICKET, { input });
    return ok(data.createTicket);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

export interface TicketGetParams {
  id?: string;
  number?: number;
  projectId?: string;
  projectName?: string;
}

export async function ticketGet(params: TicketGetParams): Promise<CallToolResult> {
  try {
    const client = getClient();

    if (params.number !== undefined) {
      const pid = await resolveProjectId(params.projectId, params.projectName);
      if (!pid) {
        return err("projectId is required when fetching by ticket number");
      }
      const data = await client.request<{ ticketByNumber: unknown }>(
        GET_TICKET_BY_NUMBER,
        { projectId: pid, number: params.number }
      );
      if (!data.ticketByNumber) {
        return err(`Ticket #${params.number} not found`);
      }
      return ok(data.ticketByNumber);
    }

    if (params.id !== undefined) {
      const data = await client.request<{ ticket: unknown }>(GET_TICKET, { id: params.id });
      if (!data.ticket) {
        return err(`Ticket ${params.id} not found`);
      }
      return ok(data.ticket);
    }

    return err("Either id or number is required");
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

export interface TicketListParams {
  state?: string;
  labelNames?: string[];
  priority?: string;
  isBlocked?: boolean;
  limit?: number;
  projectId?: string;
  projectName?: string;
}

export async function ticketList(params: TicketListParams): Promise<CallToolResult> {
  try {
    const client = getClient();
    const pid = await resolveProjectId(params.projectId, params.projectName);
    const limit = Math.min(params.limit ?? 20, 100);

    const variables: Record<string, unknown> = { first: limit };
    if (params.state !== undefined) variables.state = params.state;
    const labelNames = parseStringArray(params.labelNames);
    if (labelNames !== undefined && labelNames.length > 0) variables.labelNames = labelNames;
    if (params.priority !== undefined) variables.priority = params.priority;
    if (params.isBlocked !== undefined) variables.isBlocked = params.isBlocked;
    if (pid !== undefined) variables.projectId = pid;

    const data = await client.request<{
      tickets: {
        edges: Array<{ node: unknown }>;
        totalCount: number;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(LIST_TICKETS, variables);

    const result = {
      tickets: data.tickets.edges.map((e) => e.node),
      totalCount: data.tickets.totalCount,
      hasNextPage: data.tickets.pageInfo.hasNextPage,
    };
    return ok(result);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

export interface TicketUpdateParams {
  id: string;
  title?: string;
  description?: string;
  acceptanceCriteria?: string;
  priority?: string;
  storyPoints?: number;
}

export async function ticketUpdate(params: TicketUpdateParams): Promise<CallToolResult> {
  try {
    const client = getClient();
    const input: Record<string, unknown> = {};
    if (params.title !== undefined) input.title = params.title;
    if (params.description !== undefined) input.description = params.description;
    if (params.acceptanceCriteria !== undefined) input.acceptanceCriteria = params.acceptanceCriteria;
    if (params.priority !== undefined) input.priority = params.priority;
    if (params.storyPoints !== undefined) input.storyPoints = params.storyPoints;

    if (Object.keys(input).length === 0) {
      return err("At least one field to update must be specified");
    }

    const data = await client.request<{ updateTicket: unknown }>(UPDATE_TICKET, { id: params.id, input });
    return ok(data.updateTicket);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

export interface TicketTransitionParams {
  id: string;
  to: string;
}

export async function ticketTransition(params: TicketTransitionParams): Promise<CallToolResult> {
  try {
    const client = getClient();
    const data = await client.request<{ transitionTicket: unknown }>(
      TRANSITION_TICKET,
      { id: params.id, to: params.to }
    );
    return ok(data.transitionTicket);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}
