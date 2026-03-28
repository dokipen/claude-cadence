import { gql } from "graphql-request";
import { getClient } from "../client.js";
// --- GraphQL Documents ---
const LIST_LABELS = gql `
  query ListLabels {
    labels {
      id
      name
      color
      createdAt
    }
  }
`;
const ADD_LABEL = gql `
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
const REMOVE_LABEL = gql `
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
function ok(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function err(message) {
    return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
    };
}
// --- Tool handlers ---
export async function labelList() {
    try {
        const client = getClient();
        const data = await client.request(LIST_LABELS);
        return ok(data.labels);
    }
    catch (error) {
        return err(error instanceof Error ? error.message : String(error));
    }
}
export async function labelAdd(params) {
    try {
        const client = getClient();
        const data = await client.request(ADD_LABEL, {
            ticketId: params.ticketId,
            labelId: params.labelId,
        });
        return ok(data.addLabel);
    }
    catch (error) {
        return err(error instanceof Error ? error.message : String(error));
    }
}
export async function labelRemove(params) {
    try {
        const client = getClient();
        const data = await client.request(REMOVE_LABEL, {
            ticketId: params.ticketId,
            labelId: params.labelId,
        });
        return ok(data.removeLabel);
    }
    catch (error) {
        return err(error instanceof Error ? error.message : String(error));
    }
}
//# sourceMappingURL=labels.js.map