import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { bootstrapAuth } from "./client.js";
import { getAuthToken, getDefaultProjectId, getDefaultProjectName, setResolvedProjectId, cacheProjectIdByName } from "./config.js";
import { resolveProjectName } from "./projects.js";
import {
  ticketCreate,
  ticketGet,
  ticketList,
  ticketUpdate,
  ticketTransition,
} from "./tools/tickets.js";
import { labelList, labelAdd, labelRemove } from "./tools/labels.js";
import { commentAdd } from "./tools/comments.js";

// --- Startup validation ---

if (!getAuthToken()) {
  process.stderr.write("ISSUES_AUTH_TOKEN not set, attempting auto-authentication via gh auth token...\n");
  const ok = await bootstrapAuth();
  if (!ok) {
    process.stderr.write("Error: Authentication failed. Set ISSUES_AUTH_TOKEN or ensure `gh auth token` returns a valid token.\n");
    process.exit(1);
  }
  process.stderr.write("Auto-authentication successful.\n");
}

// Resolve ISSUES_PROJECT_NAME to ID at startup if ID is not already set
const projectName = getDefaultProjectName();
const projectId = getDefaultProjectId();

if (projectName && !projectId) {
  process.stderr.write(`Resolving project name "${projectName}" to ID...\n`);
  try {
    const resolvedId = await resolveProjectName(projectName);
    setResolvedProjectId(resolvedId);
    cacheProjectIdByName(projectName, resolvedId);
    process.stderr.write(`Resolved project "${projectName}" => ${resolvedId}\n`);
  } catch (error) {
    process.stderr.write(
      `Warning: Could not resolve project name "${projectName}": ${error instanceof Error ? error.message : String(error)}\n` +
      `Warning: Project-scoped tools will fail until ISSUES_PROJECT_ID or a resolvable ISSUES_PROJECT_NAME is set.\n`
    );
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
          description: "Project CUID (takes precedence over projectName; falls back to ISSUES_PROJECT_ID env var)",
        },
        projectName: {
          type: "string",
          description: "Project name (resolved to CUID if projectId is not provided)",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "ticket_get",
    description:
      "Get a ticket by CUID (`id`) or by project-scoped number (`number` + `projectId`). " +
      "Exactly one of `id` or `number` must be provided.",
    inputSchema: {
      type: "object",
      oneOf: [
        {
          required: ["id"],
          properties: {
            id: { type: "string", description: "Ticket CUID" },
            projectId: { type: "string", description: "Ignored when id is used" },
            projectName: { type: "string", description: "Ignored when id is used" },
          },
        },
        {
          required: ["number"],
          properties: {
            number: { type: "number", description: "Ticket number (integer)" },
            projectId: {
              type: "string",
              description: "Project CUID (takes precedence over projectName; falls back to ISSUES_PROJECT_ID)",
            },
            projectName: {
              type: "string",
              description: "Project name (resolved to CUID if projectId is not provided)",
            },
          },
        },
      ],
      properties: {
        id: { type: "string" },
        number: { type: "number" },
        projectId: { type: "string" },
        projectName: { type: "string" },
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
          description: "Project CUID filter (takes precedence over projectName; falls back to ISSUES_PROJECT_ID env var)",
        },
        projectName: {
          type: "string",
          description: "Project name filter (resolved to CUID if projectId is not provided)",
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
] as const;

// --- Server setup ---

const server = new Server(
  { name: "issues-mcp", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const params = (args ?? {}) as Record<string, unknown>;

  if (process.env.DEBUG) {
    process.stderr.write(`Tool call: ${name}\n`);
  }

  switch (name) {
    case "ticket_create":
      return ticketCreate({
        title: params.title as string,
        description: params.description as string | undefined,
        acceptanceCriteria: params.acceptanceCriteria as string | undefined,
        labelIds: params.labelIds as string[] | undefined,
        priority: params.priority as string | undefined,
        storyPoints: params.storyPoints as number | undefined,
        projectId: params.projectId as string | undefined,
        projectName: params.projectName as string | undefined,
      });

    case "ticket_get":
      return ticketGet({
        id: params.id as string | undefined,
        number: params.number as number | undefined,
        projectId: params.projectId as string | undefined,
        projectName: params.projectName as string | undefined,
      });

    case "ticket_list":
      return ticketList({
        state: params.state as string | undefined,
        labelNames: params.labelNames as string[] | undefined,
        priority: params.priority as string | undefined,
        isBlocked: params.isBlocked as boolean | undefined,
        limit: params.limit as number | undefined,
        projectId: params.projectId as string | undefined,
        projectName: params.projectName as string | undefined,
      });

    case "ticket_update":
      return ticketUpdate({
        id: params.id as string,
        title: params.title as string | undefined,
        description: params.description as string | undefined,
        acceptanceCriteria: params.acceptanceCriteria as string | undefined,
        priority: params.priority as string | undefined,
        storyPoints: params.storyPoints as number | undefined,
      });

    case "ticket_transition":
      return ticketTransition({
        id: params.id as string,
        to: params.to as string,
      });

    case "label_list":
      return labelList();

    case "label_add":
      return labelAdd({
        ticketId: params.ticketId as string,
        labelId: params.labelId as string,
      });

    case "label_remove":
      return labelRemove({
        ticketId: params.ticketId as string,
        labelId: params.labelId as string,
      });

    case "comment_add":
      return commentAdd({
        ticketId: params.ticketId as string,
        body: params.body as string,
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
