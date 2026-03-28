import { gql } from "graphql-request";
import { getClient } from "../client.js";
import { getDefaultProjectId } from "../config.js";
// --- GraphQL Documents ---
const CREATE_TICKET = gql `
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
const GET_TICKET = gql `
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
const GET_TICKET_BY_NUMBER = gql `
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
const LIST_TICKETS = gql `
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
const UPDATE_TICKET = gql `
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
const TRANSITION_TICKET = gql `
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
function ok(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function err(message) {
    return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
    };
}
function resolveProjectId(projectId) {
    return projectId ?? getDefaultProjectId();
}
export async function ticketCreate(params) {
    try {
        const client = getClient();
        const pid = resolveProjectId(params.projectId);
        if (!pid) {
            return err("projectId is required (pass it explicitly or set ISSUES_PROJECT_ID)");
        }
        const input = {
            title: params.title,
            projectId: pid,
        };
        if (params.description !== undefined)
            input.description = params.description;
        if (params.acceptanceCriteria !== undefined)
            input.acceptanceCriteria = params.acceptanceCriteria;
        if (params.labelIds !== undefined && params.labelIds.length > 0)
            input.labelIds = params.labelIds;
        if (params.priority !== undefined)
            input.priority = params.priority;
        if (params.storyPoints !== undefined)
            input.storyPoints = params.storyPoints;
        const data = await client.request(CREATE_TICKET, { input });
        return ok(data.createTicket);
    }
    catch (error) {
        return err(error instanceof Error ? error.message : String(error));
    }
}
export async function ticketGet(params) {
    try {
        const client = getClient();
        if (params.number !== undefined) {
            const pid = resolveProjectId(params.projectId);
            if (!pid) {
                return err("projectId is required when fetching by ticket number");
            }
            const data = await client.request(GET_TICKET_BY_NUMBER, { projectId: pid, number: params.number });
            if (!data.ticketByNumber) {
                return err(`Ticket #${params.number} not found`);
            }
            return ok(data.ticketByNumber);
        }
        if (params.id !== undefined) {
            const data = await client.request(GET_TICKET, { id: params.id });
            if (!data.ticket) {
                return err(`Ticket ${params.id} not found`);
            }
            return ok(data.ticket);
        }
        return err("Either id or number is required");
    }
    catch (error) {
        return err(error instanceof Error ? error.message : String(error));
    }
}
export async function ticketList(params) {
    try {
        const client = getClient();
        const pid = resolveProjectId(params.projectId);
        const limit = Math.min(params.limit ?? 20, 100);
        const variables = { first: limit };
        if (params.state !== undefined)
            variables.state = params.state;
        if (params.labelNames !== undefined && params.labelNames.length > 0)
            variables.labelNames = params.labelNames;
        if (params.priority !== undefined)
            variables.priority = params.priority;
        if (params.isBlocked !== undefined)
            variables.isBlocked = params.isBlocked;
        if (pid !== undefined)
            variables.projectId = pid;
        const data = await client.request(LIST_TICKETS, variables);
        const result = {
            tickets: data.tickets.edges.map((e) => e.node),
            totalCount: data.tickets.edges.length,
            hasNextPage: data.tickets.pageInfo.hasNextPage,
        };
        return ok(result);
    }
    catch (error) {
        return err(error instanceof Error ? error.message : String(error));
    }
}
export async function ticketUpdate(params) {
    try {
        const client = getClient();
        const input = {};
        if (params.title !== undefined)
            input.title = params.title;
        if (params.description !== undefined)
            input.description = params.description;
        if (params.acceptanceCriteria !== undefined)
            input.acceptanceCriteria = params.acceptanceCriteria;
        if (params.priority !== undefined)
            input.priority = params.priority;
        if (params.storyPoints !== undefined)
            input.storyPoints = params.storyPoints;
        if (Object.keys(input).length === 0) {
            return err("At least one field to update must be specified");
        }
        const data = await client.request(UPDATE_TICKET, { id: params.id, input });
        return ok(data.updateTicket);
    }
    catch (error) {
        return err(error instanceof Error ? error.message : String(error));
    }
}
export async function ticketTransition(params) {
    try {
        const client = getClient();
        const data = await client.request(TRANSITION_TICKET, { id: params.id, to: params.to });
        return ok(data.transitionTicket);
    }
    catch (error) {
        return err(error instanceof Error ? error.message : String(error));
    }
}
//# sourceMappingURL=tickets.js.map