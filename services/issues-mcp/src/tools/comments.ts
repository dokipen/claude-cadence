import { gql } from "graphql-request";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";

// --- GraphQL Documents ---

const ADD_COMMENT = gql`
  mutation AddComment($ticketId: ID!, $body: String!) {
    addComment(ticketId: $ticketId, body: $body) {
      id
      body
      author {
        login
        displayName
      }
      createdAt
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

export interface CommentAddParams {
  ticketId: string;
  body: string;
}

export async function commentAdd(params: CommentAddParams): Promise<CallToolResult> {
  try {
    const client = getClient();
    const data = await client.request<{
      addComment: {
        id: string;
        body: string;
        author: { login: string; displayName: string };
        createdAt: string;
      };
    }>(ADD_COMMENT, { ticketId: params.ticketId, body: params.body });
    return ok(data.addComment);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}
