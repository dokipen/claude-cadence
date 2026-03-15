import { Command } from "commander";
import { gql } from "graphql-request";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../client.js";
import { handleError } from "../errors.js";

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

function formatTicketRow(ticket: {
  id: string;
  number?: number;
  title: string;
  state: string;
  priority: string;
  storyPoints?: number | null;
  assignee?: { login: string } | null;
  labels?: { name: string }[];
}): string {
  const displayId = ticket.number != null ? chalk.bold(`#${ticket.number}`) : chalk.dim(`#${ticket.id}`);
  const state = formatState(ticket.state);
  const priority = formatPriority(ticket.priority);
  const points = ticket.storyPoints != null ? chalk.magenta(`(${ticket.storyPoints}pts)`) : "";
  const assignee = ticket.assignee ? chalk.cyan(`@${ticket.assignee.login}`) : "";
  const labels =
    ticket.labels && ticket.labels.length > 0
      ? ticket.labels.map((l) => chalk.dim(`[${l.name}]`)).join(" ")
      : "";

  return [displayId, state, priority, points, ticket.title, assignee, labels].filter(Boolean).join("  ");
}

// --- Commands ---

interface CreateOptions {
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  labels?: string;
  assignee?: string;
  project: string;
  points?: string;
  priority?: string;
}

interface ListOptions {
  state?: string;
  label?: string;
  assignee?: string;
  blocked?: boolean;
  priority?: string;
  project?: string;
  first?: string;
  after?: string;
}

interface TransitionOptions {
  to: string;
}

interface UpdateOptions {
  title?: string;
  description?: string;
  acceptanceCriteria?: string;
  points?: string;
  priority?: string;
}

export function registerTicketCommand(program: Command): void {
  const ticket = program.command("ticket").description("Manage tickets");

  // --- create ---
  ticket
    .command("create")
    .description("Create a new ticket")
    .requiredOption("--title <title>", "Ticket title")
    .requiredOption("--project <id>", "Project ID")
    .option("--description <description>", "Ticket description")
    .option("--acceptance-criteria <criteria>", "Acceptance criteria")
    .option("--labels <ids>", "Comma-separated label IDs")
    .option("--assignee <id>", "Assignee user ID")
    .option("--points <points>", "Story points")
    .option("--priority <priority>", "Priority (HIGHEST, HIGH, MEDIUM, LOW, LOWEST)")
    .action(async (opts: CreateOptions) => {
      const spinner = ora("Creating ticket...").start();
      try {
        const client = getClient();
        const input: Record<string, unknown> = {
          title: opts.title,
          projectId: opts.project,
        };
        if (opts.description) input.description = opts.description;
        if (opts.acceptanceCriteria) input.acceptanceCriteria = opts.acceptanceCriteria;
        if (opts.labels) input.labelIds = opts.labels.split(",").map((s) => s.trim());
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
    .option("--project <id>", "Project ID (required when using ticket number)")
    .action(async (id: string, opts: { project?: string }) => {
      const spinner = ora("Fetching ticket...").start();
      try {
        const client = getClient();
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
          if (!opts.project) {
            spinner.fail("--project is required when using a ticket number");
            process.exit(1);
          }
          const data = await client.request<{ ticketByNumber: TicketDetail | null }>(
            GET_TICKET_BY_NUMBER,
            { projectId: opts.project, number: parseInt(id, 10) }
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

        console.log();
        console.log(chalk.bold(`  #${t.number}  ${t.title}`));
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
    .option("--project <id>", "Filter by project ID")
    .option("--first <count>", "Number of tickets to fetch", "20")
    .option("--after <cursor>", "Cursor for pagination")
    .action(async (opts: ListOptions) => {
      const spinner = ora("Fetching tickets...").start();
      try {
        const client = getClient();
        const variables: Record<string, unknown> = {
          first: parseInt(opts.first ?? "20", 10),
        };
        if (opts.state) variables.state = opts.state;
        if (opts.label) variables.labelName = opts.label;
        if (opts.assignee) variables.assigneeLogin = opts.assignee;
        if (opts.blocked) variables.isBlocked = true;
        if (opts.priority) variables.priority = opts.priority;
        if (opts.project) variables.projectId = opts.project;
        if (opts.after) variables.after = opts.after;

        const data = await client.request<{
          tickets: {
            edges: Array<{
              cursor: string;
              node: {
                id: string;
                number: number;
                title: string;
                state: string;
                priority: string;
                storyPoints: number | null;
                assignee: { login: string } | null;
                labels: { name: string }[];
              };
            }>;
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
          };
        }>(LIST_TICKETS, variables);

        spinner.stop();

        const { edges, pageInfo } = data.tickets;

        if (edges.length === 0) {
          console.log(chalk.dim("  No tickets found."));
          console.log();
          return;
        }

        console.log();
        for (const edge of edges) {
          console.log(`  ${formatTicketRow(edge.node)}`);
        }
        console.log();

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
    .description("Update a ticket")
    .option("--title <title>", "New title")
    .option("--description <description>", "New description")
    .option("--acceptance-criteria <criteria>", "New acceptance criteria")
    .option("--points <points>", "New story points")
    .option("--priority <priority>", "New priority (HIGHEST, HIGH, MEDIUM, LOW, LOWEST)")
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
        }>(UPDATE_TICKET, { id, input });

        spinner.succeed("Ticket updated");
        const t = data.updateTicket;
        console.log();
        console.log(`  ${chalk.bold(`#${t.id}`)}  ${t.title}`);
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
    .requiredOption("--to <state>", "Target state (BACKLOG, REFINED, IN_PROGRESS, CLOSED)")
    .action(async (id: string, opts: TransitionOptions) => {
      const spinner = ora("Transitioning ticket...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          transitionTicket: {
            id: string;
            number: number;
            title: string;
            state: string;
            priority: string;
          };
        }>(TRANSITION_TICKET, { id, to: opts.to });

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
