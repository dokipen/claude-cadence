import { gql } from "graphql-request";
import { getClient } from "../client.js";
// --- GraphQL Documents ---
const ADD_COMMENT = gql `
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
function ok(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function err(message) {
    return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
    };
}
export async function commentAdd(params) {
    try {
        const client = getClient();
        const data = await client.request(ADD_COMMENT, { ticketId: params.ticketId, body: params.body });
        return ok(data.addComment);
    }
    catch (error) {
        return err(error instanceof Error ? error.message : String(error));
    }
}
//# sourceMappingURL=comments.js.map