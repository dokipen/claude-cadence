import { Command } from "commander";
import { gql } from "graphql-request";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../client.js";
import { handleError } from "../errors.js";
import { resolveProjectId } from "../project-resolver.js";
import { resolveLabelIds } from "../resolve-label.js";
import { resolveTicketId } from "../resolve-ticket.js";

// --- GraphQL Documents ---

const CREATE_TICKET = gql`
  mutation CreateTicket($input: CreateTicketInput!) {
    createTicket(input: $input) {
      id
      number
      title
      state
      priority
      storyPoints
      labels {
        id
        name
      }
      project {
        id
        name
      }
      createdAt
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
    $labelName: String
    $assigneeLogin: String
    $isBlocked: Boolean
    $priority: Priority
    $projectId: ID
    $first: Int
    $after: String
  ) {
    tickets(
      state: $state
      labelName: $labelName
      assigneeLogin: $assigneeLogin
      isBlocked: $isBlocked
      priority: $priority
      projectId: $projectId
      first: $first
      after: $after
    ) {
      edges {
        cursor
        node {
          id
          number
          title
          state
          priority
          storyPoints
          assignee {
            login
          }
          project {
            id
            name
          }
          labels {
            name
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const LIST_TICKETS_VERBOSE = gql`
  query ListTicketsVerbose(
    $state: TicketState
    $labelName: String
    $assigneeLogin: String
    $isBlocked: Boolean
    $priority: Priority
    $projectId: ID
    $first: Int
    $after: String
  ) {
    tickets(
      state: $state
      labelName: $labelName
      assigneeLogin: $assigneeLogin
      isBlocked: $isBlocked
      priority: $priority
      projectId: $projectId
      first: $first
      after: $after
    ) {
      edges {
        cursor
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
          }
          project {
            id
            name
          }
          labels {
            id
            name
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

const TRANSITION_TICKET = gql`
  mutation TransitionTicket($id: ID!, $to: TicketState!) {
    transitionTicket(id: $id, to: $to) {
      id
      number
      title
      state
      priority
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

// --- Formatting Helpers ---

const STATE_COLORS: Record<string, (text: string) => string> = {
  BACKLOG: chalk.gray,
  REFINED: chalk.blue,
  IN_PROGRESS: chalk.yellow,
  CLOSED: chalk.green,
};

const PRIORITY_COLORS: Record<string, (text: string) => string> = {
  HIGHEST: chalk.red.bold,
  HIGH: chalk.red,
  MEDIUM: chalk.yellow,
  LOW: chalk.cyan,
  LOWEST: chalk.gray,
};

function formatState(state: string): string {
  const colorFn = STATE_COLORS[state] ?? chalk.white;
  return colorFn(`[${state}]`);
}

function formatPriority(priority: string): string {
  const colorFn = PRIORITY_COLORS[priority] ?? chalk.white;
  return colorFn(priority);
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

interface TicketNode {
  id: string;
  number?: number;
  title: string;
  state: string;
  priority: string;
  storyPoints?: number | null;
  assignee?: { login: string } | null;
  project?: { name: string } | null;
  labels?: { name: string }[];
}

function formatTicketTable(tickets: TicketNode[], options?: { showProject?: boolean }, maxWidth = 120): string {
  const showProject = options?.showProject ?? false;

  const rows = tickets.map((t) => {
    const id = t.number != null ? chalk.bold(`#${t.number}`) : chalk.dim(`#${t.id}`);
    const state = formatState(t.state);
    const priority = formatPriority(t.priority);
    const project = showProject && t.project ? chalk.green(t.project.name) : "";
    const points = t.storyPoints != null ? chalk.magenta(`${t.storyPoints}pts`) : chalk.dim("-");
    const assignee = t.assignee ? chalk.cyan(`@${t.assignee.login}`) : chalk.dim("-");
    return { id, state, priority, project, title: t.title, points, assignee };
  });

  // Measure visible widths (strip ANSI)
  const widths: Record<string, number> = { id: 0, state: 0, priority: 0, points: 0, assignee: 0 };
  if (showProject) widths.project = 0;
  for (const r of rows) {
    widths.id = Math.max(widths.id, stripAnsi(r.id).length);
    widths.state = Math.max(widths.state, stripAnsi(r.state).length);
    widths.priority = Math.max(widths.priority, stripAnsi(r.priority).length);
    if (showProject) widths.project = Math.max(widths.project, stripAnsi(r.project).length);
    widths.points = Math.max(widths.points, stripAnsi(r.points).length);
    widths.assignee = Math.max(widths.assignee, stripAnsi(r.assignee).length);
  }

  // Title gets remaining space after fixed columns (2-char gaps between each column, 2-char left indent)
  let fixedWidth = 2 + widths.id + 2 + widths.state + 2 + widths.priority + 2 + 2 + widths.points + 2 + widths.assignee;
  if (showProject) fixedWidth += widths.project + 2;
  const titleWidth = Math.max(20, maxWidth - fixedWidth);

  function pad(s: string, w: number): string {
    const visible = stripAnsi(s).length;
    return visible < w ? s + " ".repeat(w - visible) : s;
  }

  return rows
    .map((r) => {
      const chars = Array.from(r.title);
      const visibleTitle = chars.length > titleWidth ? chars.slice(0, titleWidth - 1).join("") + "…" : r.title;
      const projectCol = showProject ? `  ${pad(r.project, widths.project)}` : "";
      return `  ${pad(r.id, widths.id)}  ${pad(r.state, widths.state)}  ${pad(r.priority, widths.priority)}${projectCol}  ${pad(visibleTitle, titleWidth)}  ${pad(r.points, widths.points)}  ${r.assignee}`;
    })
    .join("\n");
}

// --- Commands ---

interface CreateOptions {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  labels?: string;
  assignee?: string;
  project?: string;
  points?: string;
  priority?: string;
  json?: boolean;
}

interface ListOptions {
  state?: string;
  label?: string;
  assignee?: string;
  blocked?: boolean;
  priority?: string;
  project?: string;
  limit?: string;
  after?: string;
  json?: boolean;
  verbose?: boolean;
}

interface TransitionOptions {
  to: string;
  project?: string;
  json?: boolean;
}

interface UpdateOptions {
  title?: string;
  description?: string;
  acceptanceCriteria?: string;
  points?: string;
  priority?: string;
  project?: string;
  json?: boolean;
}

export function registerTicketCommand(program: Command): void {
  const ticket = program.command("ticket").description("Manage tickets");

  // --- create ---
  ticket
    .command("create")
    .description("Create a new ticket")
    .requiredOption("--title <title>", "Ticket title")
    .option("--project <project>", "Project name or ID (inferred from git origin if omitted)")
    .option("--description <description>", "Ticket description")
    .option("--acceptance-criteria <criteria>", "Acceptance criteria")
    .option("--labels <names-or-ids>", "Comma-separated label names or IDs")
    .option("--assignee <id>", "Assignee user ID")
    .option("--points <points>", "Story points")
    .option("--priority <priority>", "Priority (HIGHEST, HIGH, MEDIUM, LOW, LOWEST)")
    .option("--json", "Output raw JSON")
    .action(async (opts: CreateOptions) => {
      const spinner = ora("Creating ticket...").start();
      try {
        const client = getClient();
        const projectId = await resolveProjectId(opts.project);
        const input: Record<string, unknown> = {
          title: opts.title,
          projectId,
        };
        if (opts.description) input.description = opts.description;
        if (opts.acceptanceCriteria) input.acceptanceCriteria = opts.acceptanceCriteria;
        if (opts.labels) {
          const labelTokens = opts.labels.split(",").map((s) => s.trim());
          input.labelIds = await resolveLabelIds(labelTokens);
        }
        if (opts.assignee) input.assigneeId = opts.assignee;
        if (opts.points) input.storyPoints = parseInt(opts.points, 10);
        if (opts.priority) input.priority = opts.priority;

        const data = await client.request<{
          createTicket: {
            id: string;
            number: number;
            title: string;
            state: string;
            priority: string;
            storyPoints: number | null;
            labels: { id: string; name: string }[];
            project: { id: string; name: string };
            createdAt: string;
          };
        }>(CREATE_TICKET, { input });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.createTicket, null, 2));
          return;
        }

        spinner.succeed("Ticket created");
        const t = data.createTicket;
        console.log();
        console.log(`  ${chalk.bold(`#${t.id}`)}  ${t.title}`);
        console.log(`  Number: ${chalk.bold(`#${t.number}`)}  State: ${formatState(t.state)}  Priority: ${formatPriority(t.priority)}`);
        if (t.storyPoints != null) {
          console.log(`  Story Points: ${chalk.magenta(String(t.storyPoints))}`);
        }
        if (t.labels.length > 0) {
          console.log(`  Labels: ${t.labels.map((l) => l.name).join(", ")}`);
        }
        console.log();
      } catch (error) {
        spinner.fail("Failed to create ticket");
        handleError(error);
      }
    });

  // --- view ---
  ticket
    .command("view <id>")
    .description("View ticket details (accepts ticket number or CUID)")
    .option("--project <project>", "Project name or ID (inferred from git origin if omitted)")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { project?: string; json?: boolean }) => {
      const spinner = ora("Fetching ticket...").start();
      try {
        const client = getClient();
        // Intentionally NOT using resolveTicketId here: view fetches the full
        // ticket directly by number in a single query, avoiding a two-round-trip
        // resolve-then-fetch pattern.
        const isNumber = /^\d+$/.test(id);

        type TicketDetail = {
          id: string;
          number: number;
          title: string;
          description: string | null;
          acceptanceCriteria: string | null;
          state: string;
          storyPoints: number | null;
          priority: string;
          assignee: { id: string; login: string; displayName: string } | null;
          project: { id: string; name: string };
          labels: { id: string; name: string; color: string }[];
          comments: {
            id: string;
            body: string;
            author: { login: string; displayName: string };
            createdAt: string;
          }[];
          blocks: { id: string; number: number; title: string; state: string }[];
          blockedBy: { id: string; number: number; title: string; state: string }[];
          createdAt: string;
          updatedAt: string;
        };

        let t: TicketDetail | null;

        if (isNumber) {
          const projectId = await resolveProjectId(opts.project);
          const data = await client.request<{ ticketByNumber: TicketDetail | null }>(
            GET_TICKET_BY_NUMBER,
            { projectId, number: parseInt(id, 10) }
          );
          t = data.ticketByNumber;
        } else {
          const data = await client.request<{ ticket: TicketDetail | null }>(GET_TICKET, { id });
          t = data.ticket;
        }

        spinner.stop();

        if (!t) {
          console.error(chalk.red(`Ticket #${id} not found`));
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(t, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`  #${t.number}  ${t.title}`));
        console.log(`  ID: ${chalk.dim(t.id)}`);
        console.log(
          `  State: ${formatState(t.state)}  Priority: ${formatPriority(t.priority)}`
        );

        console.log(`  Project: ${chalk.bold(t.project.name)}`);

        if (t.storyPoints != null) {
          console.log(`  Story Points: ${chalk.magenta(String(t.storyPoints))}`);
        }

        if (t.assignee) {
          console.log(
            `  Assignee: ${chalk.cyan(`@${t.assignee.login}`)} (${t.assignee.displayName})`
          );
        }

        if (t.labels.length > 0) {
          console.log(`  Labels: ${t.labels.map((l) => chalk.hex(l.color)(l.name)).join(", ")}`);
        }

        console.log(`  Created: ${chalk.dim(t.createdAt)}  Updated: ${chalk.dim(t.updatedAt)}`);

        if (t.description) {
          console.log();
          console.log(chalk.bold("  Description"));
          console.log(`  ${t.description}`);
        }

        if (t.acceptanceCriteria) {
          console.log();
          console.log(chalk.bold("  Acceptance Criteria"));
          console.log(`  ${t.acceptanceCriteria}`);
        }

        if (t.blockedBy.length > 0) {
          console.log();
          console.log(chalk.bold("  Blocked By"));
          for (const b of t.blockedBy) {
            console.log(`    #${b.number} ${b.title} ${formatState(b.state)}`);
          }
        }

        if (t.blocks.length > 0) {
          console.log();
          console.log(chalk.bold("  Blocks"));
          for (const b of t.blocks) {
            console.log(`    #${b.number} ${b.title} ${formatState(b.state)}`);
          }
        }

        if (t.comments.length > 0) {
          console.log();
          console.log(chalk.bold(`  Comments (${t.comments.length})`));
          for (const c of t.comments) {
            console.log();
            console.log(
              `    ${chalk.cyan(`@${c.author.login}`)} ${chalk.dim(c.createdAt)}`
            );
            console.log(`    ${c.body}`);
          }
        }

        console.log();
      } catch (error) {
        spinner.fail("Failed to fetch ticket");
        handleError(error);
      }
    });

  // --- list ---
  ticket
    .command("list")
    .description("List tickets")
    .option("--state <state>", "Filter by state (BACKLOG, REFINED, IN_PROGRESS, CLOSED)")
    .option("--label <name>", "Filter by label name")
    .option("--assignee <login>", "Filter by assignee login")
    .option("--blocked", "Filter to only blocked tickets")
    .option("--priority <priority>", "Filter by priority (HIGHEST, HIGH, MEDIUM, LOW, LOWEST)")
    .option("--project <project>", "Filter by project name or ID (inferred from git origin if omitted)")
    .option("-l, --limit <count>", "Max number of tickets to return", "100")
    .option("--after <cursor>", "Cursor for pagination")
    .option("--json", "Output raw JSON")
    .option("-v, --verbose", "Show full ticket details including description and acceptance criteria")
    .action(async (opts: ListOptions) => {
      const limit = Number(opts.limit);
      if (!Number.isInteger(limit) || limit <= 0) {
        console.error(chalk.red("Error: --limit must be a positive integer"));
        process.exitCode = 1;
        return;
      }
      const spinner = ora("Fetching tickets...").start();
      try {
        // Resolve project: explicit name/ID takes precedence, otherwise infer from git origin
        let projectId: string | undefined;
        try {
          projectId = await resolveProjectId(opts.project);
        } catch (e) {
          if (opts.project) throw e; // Re-throw if user explicitly provided a project
          // Inference is best-effort for list — continue without project filter
        }

        const client = getClient();
        const variables: Record<string, unknown> = {
          first: limit,
        };
        if (opts.state) variables.state = opts.state;
        if (opts.label) variables.labelName = opts.label;
        if (opts.assignee) variables.assigneeLogin = opts.assignee;
        if (opts.blocked) variables.isBlocked = true;
        if (opts.priority) variables.priority = opts.priority;
        if (projectId) variables.projectId = projectId;
        if (opts.after) variables.after = opts.after;

        type TicketNode = {
          id: string;
          number: number;
          title: string;
          state: string;
          priority: string;
          storyPoints: number | null;
          assignee: { login: string } | null;
          project: { id: string; name: string } | null;
          labels: { id?: string; name: string }[];
          description?: string | null;
          acceptanceCriteria?: string | null;
          createdAt?: string;
          updatedAt?: string;
        };

        const data = await client.request<{
          tickets: {
            edges: Array<{
              cursor: string;
              node: TicketNode;
            }>;
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
          };
        }>(opts.verbose ? LIST_TICKETS_VERBOSE : LIST_TICKETS, variables);

        spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify(data.tickets, null, 2));
          return;
        }

        const { edges, pageInfo } = data.tickets;

        if (edges.length === 0) {
          console.log(chalk.dim("  No tickets found."));
          console.log();
          return;
        }

        // Show project column when not filtering by a specific project
        const showProject = !projectId;

        console.log();
        if (opts.verbose) {
          for (const edge of edges) {
            const t = edge.node;
            console.log(formatTicketTable([{ ...t, labels: [] }], { showProject }));
            if (t.labels.length > 0) {
              const labelStr = t.labels
                .map((l) => l.id ? `${l.name} ${chalk.dim(`(${l.id})`)}` : l.name)
                .join(", ");
              console.log(`    Labels: ${labelStr}`);
            }
            if (t.description) {
              console.log();
              console.log(chalk.bold("    Description"));
              for (const line of t.description.split("\n")) {
                console.log(`    ${line}`);
              }
            }
            if (t.acceptanceCriteria) {
              console.log();
              console.log(chalk.bold("    Acceptance Criteria"));
              for (const line of t.acceptanceCriteria.split("\n")) {
                console.log(`    ${line}`);
              }
            }
            console.log();
          }
        } else {
          console.log(formatTicketTable(edges.map((e: { node: TicketNode }) => e.node), { showProject }));
          console.log();
        }

        if (pageInfo.hasNextPage) {
          console.log(
            chalk.dim(`  More results available. Use --after ${pageInfo.endCursor} to continue.`)
          );
          console.log();
        }
      } catch (error) {
        spinner.fail("Failed to list tickets");
        handleError(error);
      }
    });

  // --- update ---
  ticket
    .command("update <id>")
    .alias("edit")
    .description("Update a ticket")
    .option("--project <project>", "Project name or ID (required when using ticket number)")
    .option("--title <title>", "New title")
    .option("--description <description>", "New description")
    .option("--acceptance-criteria <criteria>", "New acceptance criteria")
    .option("--points <points>", "New story points")
    .option("--priority <priority>", "New priority (HIGHEST, HIGH, MEDIUM, LOW, LOWEST)")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: UpdateOptions) => {
      const input: Record<string, unknown> = {};
      if (opts.title) input.title = opts.title;
      if (opts.description) input.description = opts.description;
      if (opts.acceptanceCriteria) input.acceptanceCriteria = opts.acceptanceCriteria;
      if (opts.points) input.storyPoints = parseInt(opts.points, 10);
      if (opts.priority) input.priority = opts.priority;

      if (Object.keys(input).length === 0) {
        console.error(
          chalk.red("Error: At least one field to update must be specified.")
        );
        process.exit(1);
      }

      const spinner = ora("Updating ticket...").start();
      try {
        const resolvedId = await resolveTicketId(id, opts.project);
        const client = getClient();
        const data = await client.request<{
          updateTicket: {
            id: string;
            number: number;
            title: string;
            description: string | null;
            acceptanceCriteria: string | null;
            state: string;
            storyPoints: number | null;
            priority: string;
            updatedAt: string;
          };
        }>(UPDATE_TICKET, { id: resolvedId, input });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.updateTicket, null, 2));
          return;
        }

        spinner.succeed("Ticket updated");
        const t = data.updateTicket;
        console.log();
        console.log(`  ${chalk.bold(`#${t.number}`)}  ${t.title}`);
        console.log(`  State: ${formatState(t.state)}  Priority: ${formatPriority(t.priority)}`);
        if (t.storyPoints != null) {
          console.log(`  Story Points: ${chalk.magenta(String(t.storyPoints))}`);
        }
        console.log();
      } catch (error) {
        spinner.fail("Failed to update ticket");
        handleError(error);
      }
    });

  // --- transition ---
  ticket
    .command("transition <id>")
    .description("Transition a ticket to a new state")
    .option("--project <project>", "Project name or ID (required when using ticket number)")
    .requiredOption("--to <state>", "Target state (BACKLOG, REFINED, IN_PROGRESS, CLOSED)")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: TransitionOptions) => {
      const spinner = ora("Transitioning ticket...").start();
      try {
        const resolvedId = await resolveTicketId(id, opts.project);
        const client = getClient();
        const data = await client.request<{
          transitionTicket: {
            id: string;
            number: number;
            title: string;
            state: string;
            priority: string;
          };
        }>(TRANSITION_TICKET, { id: resolvedId, to: opts.to });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.transitionTicket, null, 2));
          return;
        }

        spinner.succeed("Ticket transitioned");
        const t = data.transitionTicket;
        console.log();
        console.log(`  ${chalk.bold(`#${t.id}`)}  ${t.title}`);
        console.log(`  State: ${formatState(t.state)}  Priority: ${formatPriority(t.priority)}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to transition ticket");
        handleError(error);
      }
    });
}
