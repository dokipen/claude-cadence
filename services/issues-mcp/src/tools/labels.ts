import { gql } from "graphql-request";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";

// --- GraphQL Documents ---

const LIST_LABELS = gql`
  query ListLabels {
    labels {
      id
      name
      color
      createdAt
    }
  }
`;

const ADD_LABEL = gql`
  mutation AddLabel($ticketId: ID!, $labelId: ID!) {
    addLabel(ticketId: $ticketId, labelId: $labelId) {
      id
      title
      labels {
        id
        name
        color
      }
    }
  }
`;

const REMOVE_LABEL = gql`
  mutation RemoveLabel($ticketId: ID!, $labelId: ID!) {
    removeLabel(ticketId: $ticketId, labelId: $labelId) {
      id
      title
      labels {
        id
        name
        color
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

// --- Tool handlers ---

export async function labelList(): Promise<CallToolResult> {
  try {
    const client = getClient();
    const data = await client.request<{
      labels: Array<{ id: string; name: string; color: string; createdAt: string }>;
    }>(LIST_LABELS);
    return ok(data.labels);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

export interface LabelAddParams {
  ticketId: string;
  labelId: string;
}

export async function labelAdd(params: LabelAddParams): Promise<CallToolResult> {
  try {
    const client = getClient();
    const data = await client.request<{ addLabel: unknown }>(ADD_LABEL, {
      ticketId: params.ticketId,
      labelId: params.labelId,
    });
    return ok(data.addLabel);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

export interface LabelRemoveParams {
  ticketId: string;
  labelId: string;
}

export async function labelRemove(params: LabelRemoveParams): Promise<CallToolResult> {
  try {
    const client = getClient();
    const data = await client.request<{ removeLabel: unknown }>(REMOVE_LABEL, {
      ticketId: params.ticketId,
      labelId: params.labelId,
    });
    return ok(data.removeLabel);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}
