import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { gql } from "graphql-request";
import { getClient } from "./client.js";
import { getAuthToken, getDefaultProjectId, getDefaultProjectName } from "./config.js";
import { ticketCreate, ticketGet, ticketList, ticketUpdate, ticketTransition, } from "./tools/tickets.js";
import { labelList, labelAdd, labelRemove } from "./tools/labels.js";
import { commentAdd } from "./tools/comments.js";
// --- Project name resolution ---
const GET_PROJECT_BY_NAME = gql `
  query GetProjectByName($name: String!) {
    projectByName(name: $name) {
      id
      name
    }
  }
`;
async function resolveProjectName(name) {
    const client = getClient();
    const data = await client.request(GET_PROJECT_BY_NAME, { name });
    if (!data.projectByName) {
        throw new Error(`Project not found: "${name}"`);
    }
    return data.projectByName.id;
}
// --- Startup validation ---
const token = getAuthToken();
if (!token) {
    process.stderr.write("Error: ISSUES_AUTH_TOKEN environment variable is required\n");
    process.exit(1);
}
// Resolve ISSUES_PROJECT_NAME to ID at startup if ID is not already set
const projectName = getDefaultProjectName();
const projectId = getDefaultProjectId();
if (projectName && !projectId) {
    process.stderr.write(`Resolving project name "${projectName}" to ID...\n`);
    try {
        const resolvedId = await resolveProjectName(projectName);
        process.env.ISSUES_PROJECT_ID = resolvedId;
        process.stderr.write(`Resolved project "${projectName}" => ${resolvedId}\n`);
    }
    catch (error) {
        process.stderr.write(`Warning: Could not resolve project name "${projectName}": ${error instanceof Error ? error.message : String(error)}\n`);
    }
}
// --- Tool definitions ---
const TOOLS = [
    {
        name: "ticket_create",
        description: "Create a new ticket in the issues tracker",
        inputSchema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Ticket title (required)" },
                description: { type: "string", description: "Ticket description" },
                acceptanceCriteria: { type: "string", description: "Acceptance criteria" },
                labelIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of label IDs to attach",
                },
                priority: {
                    type: "string",
                    enum: ["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"],
                    description: "Ticket priority",
                },
                storyPoints: {
                    type: "number",
                    description: "Story point estimate (Fibonacci scale: 1, 2, 3, 5, 8, 13)",
                },
                projectId: {
                    type: "string",
                    description: "Project ID (falls back to ISSUES_PROJECT_ID env var)",
                },
            },
            required: ["title"],
        },
    },
    {
        name: "ticket_get",
        description: "Get a ticket by CUID or by ticket number (requires projectId when using number)",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Ticket CUID" },
                number: { type: "number", description: "Ticket number (integer)" },
                projectId: {
                    type: "string",
                    description: "Project ID (required when using number; falls back to ISSUES_PROJECT_ID)",
                },
            },
        },
    },
    {
        name: "ticket_list",
        description: "List and filter tickets",
        inputSchema: {
            type: "object",
            properties: {
                state: {
                    type: "string",
                    enum: ["BACKLOG", "REFINED", "IN_PROGRESS", "CLOSED"],
                    description: "Filter by ticket state",
                },
                labelNames: {
                    type: "array",
                    items: { type: "string" },
                    description: "Filter by label names (OR logic)",
                },
                priority: {
                    type: "string",
                    enum: ["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"],
                    description: "Filter by priority",
                },
                isBlocked: { type: "boolean", description: "Filter to only blocked tickets" },
                limit: {
                    type: "number",
                    description: "Max tickets to return (default: 20, max: 100)",
                },
                projectId: {
                    type: "string",
                    description: "Project ID filter (falls back to ISSUES_PROJECT_ID env var)",
                },
            },
        },
    },
    {
        name: "ticket_update",
        description: "Update ticket fields",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Ticket CUID (required)" },
                title: { type: "string", description: "New title" },
                description: { type: "string", description: "New description" },
                acceptanceCriteria: { type: "string", description: "New acceptance criteria" },
                priority: {
                    type: "string",
                    enum: ["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"],
                    description: "New priority",
                },
                storyPoints: { type: "number", description: "New story points" },
            },
            required: ["id"],
        },
    },
    {
        name: "ticket_transition",
        description: "Transition a ticket to a new state",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Ticket CUID (required)" },
                to: {
                    type: "string",
                    enum: ["BACKLOG", "REFINED", "IN_PROGRESS", "CLOSED"],
                    description: "Target state (required)",
                },
            },
            required: ["id", "to"],
        },
    },
    {
        name: "label_list",
        description: "List all available labels",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "label_add",
        description: "Add a label to a ticket",
        inputSchema: {
            type: "object",
            properties: {
                ticketId: { type: "string", description: "Ticket CUID (required)" },
                labelId: { type: "string", description: "Label CUID (required)" },
            },
            required: ["ticketId", "labelId"],
        },
    },
    {
        name: "label_remove",
        description: "Remove a label from a ticket",
        inputSchema: {
            type: "object",
            properties: {
                ticketId: { type: "string", description: "Ticket CUID (required)" },
                labelId: { type: "string", description: "Label CUID (required)" },
            },
            required: ["ticketId", "labelId"],
        },
    },
    {
        name: "comment_add",
        description: "Add a comment to a ticket",
        inputSchema: {
            type: "object",
            properties: {
                ticketId: { type: "string", description: "Ticket CUID (required)" },
                body: { type: "string", description: "Comment body (required)" },
            },
            required: ["ticketId", "body"],
        },
    },
];
// --- Server setup ---
const server = new Server({ name: "issues-mcp", version: "0.0.1" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {});
    process.stderr.write(`Tool call: ${name}\n`);
    switch (name) {
        case "ticket_create":
            return ticketCreate({
                title: params.title,
                description: params.description,
                acceptanceCriteria: params.acceptanceCriteria,
                labelIds: params.labelIds,
                priority: params.priority,
                storyPoints: params.storyPoints,
                projectId: params.projectId,
            });
        case "ticket_get":
            return ticketGet({
                id: params.id,
                number: params.number,
                projectId: params.projectId,
            });
        case "ticket_list":
            return ticketList({
                state: params.state,
                labelNames: params.labelNames,
                priority: params.priority,
                isBlocked: params.isBlocked,
                limit: params.limit,
                projectId: params.projectId,
            });
        case "ticket_update":
            return ticketUpdate({
                id: params.id,
                title: params.title,
                description: params.description,
                acceptanceCriteria: params.acceptanceCriteria,
                priority: params.priority,
                storyPoints: params.storyPoints,
            });
        case "ticket_transition":
            return ticketTransition({
                id: params.id,
                to: params.to,
            });
        case "label_list":
            return labelList();
        case "label_add":
            return labelAdd({
                ticketId: params.ticketId,
                labelId: params.labelId,
            });
        case "label_remove":
            return labelRemove({
                ticketId: params.ticketId,
                labelId: params.labelId,
            });
        case "comment_add":
            return commentAdd({
                ticketId: params.ticketId,
                body: params.body,
            });
        default:
            return {
                content: [{ type: "text", text: `Error: Unknown tool: ${name}` }],
                isError: true,
            };
    }
});
// --- Start server ---
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("issues-mcp server running on stdio\n");
//# sourceMappingURL=index.js.map