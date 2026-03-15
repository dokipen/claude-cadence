import { Command } from "commander";
import { gql } from "graphql-request";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../client.js";
import { handleError } from "../errors.js";
import { resolveTicketId } from "../resolve-ticket.js";

// --- GraphQL Documents ---

const ASSIGN_TICKET = gql`
  mutation AssignTicket($ticketId: ID!, $userId: ID!) {
    assignTicket(ticketId: $ticketId, userId: $userId) {
      id
      title
      assignee {
        id
        login
        displayName
      }
    }
  }
`;

const UNASSIGN_TICKET = gql`
  mutation UnassignTicket($ticketId: ID!) {
    unassignTicket(ticketId: $ticketId) {
      id
      title
      assignee {
        id
        login
        displayName
      }
    }
  }
`;

// --- Commands ---

export function registerAssignCommand(program: Command): void {
  // --- assign ---
  program
    .command("assign <ticket-id>")
    .description("Assign a ticket to a user")
    .option("--project <id>", "Project ID (required when using ticket number)")
    .requiredOption("--user <id>", "User ID")
    .action(async (ticketId: string, opts: { user: string; project?: string }) => {
      const spinner = ora("Assigning ticket...").start();
      try {
        const resolvedId = await resolveTicketId(ticketId, opts.project);
        const client = getClient();
        const data = await client.request<{
          assignTicket: {
            id: string;
            title: string;
            assignee: { id: string; login: string; displayName: string } | null;
          };
        }>(ASSIGN_TICKET, { ticketId: resolvedId, userId: opts.user });

        spinner.succeed("Ticket assigned");
        const t = data.assignTicket;
        console.log();
        console.log(`  ${chalk.bold(`#${t.id}`)}  ${t.title}`);
        if (t.assignee) {
          console.log(`  Assignee: ${chalk.cyan(`@${t.assignee.login}`)} (${t.assignee.displayName})`);
        }
        console.log();
      } catch (error) {
        spinner.fail("Failed to assign ticket");
        handleError(error);
      }
    });

  // --- unassign ---
  program
    .command("unassign <ticket-id>")
    .description("Unassign a ticket")
    .option("--project <id>", "Project ID (required when using ticket number)")
    .action(async (ticketId: string, opts: { project?: string }) => {
      const spinner = ora("Unassigning ticket...").start();
      try {
        const resolvedId = await resolveTicketId(ticketId, opts.project);
        const client = getClient();
        const data = await client.request<{
          unassignTicket: {
            id: string;
            title: string;
            assignee: null;
          };
        }>(UNASSIGN_TICKET, { ticketId: resolvedId });

        spinner.succeed("Ticket unassigned");
        const t = data.unassignTicket;
        console.log();
        console.log(`  ${chalk.bold(`#${t.id}`)}  ${t.title}`);
        console.log(`  Assignee: ${chalk.dim("none")}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to unassign ticket");
        handleError(error);
      }
    });
}
