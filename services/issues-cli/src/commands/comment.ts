import { Command } from "commander";
import { gql } from "graphql-request";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../client.js";
import { handleError } from "../errors.js";
import { resolveTicketId } from "../resolve-ticket.js";

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

const UPDATE_COMMENT = gql`
  mutation UpdateComment($id: ID!, $body: String!) {
    updateComment(id: $id, body: $body) {
      id
      body
      author {
        login
        displayName
      }
      createdAt
      updatedAt
    }
  }
`;

const DELETE_COMMENT = gql`
  mutation DeleteComment($id: ID!) {
    deleteComment(id: $id) {
      id
      body
    }
  }
`;

// --- Commands ---

export function registerCommentCommand(program: Command): void {
  const comment = program.command("comment").description("Manage comments");

  // --- add ---
  comment
    .command("add <ticket-id>")
    .description("Add a comment to a ticket")
    .option("--project <id>", "Project ID (required when using ticket number)")
    .requiredOption("--body <body>", "Comment body")
    .option("--json", "Output raw JSON")
    .action(async (ticketId: string, opts: { body: string; project?: string; json?: boolean }) => {
      const spinner = ora({ text: "Adding comment...", isSilent: !!opts.json }).start();
      try {
        const resolvedId = await resolveTicketId(ticketId, opts.project);
        const client = getClient();
        const data = await client.request<{
          addComment: {
            id: string;
            body: string;
            author: { login: string; displayName: string };
            createdAt: string;
          };
        }>(ADD_COMMENT, { ticketId: resolvedId, body: opts.body });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.addComment, null, 2));
          return;
        }

        spinner.succeed("Comment added");
        const c = data.addComment;
        console.log();
        console.log(`  ${chalk.bold(`@${c.author.login}`)}  ${chalk.dim(c.createdAt)}`);
        console.log(`    ${c.body}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to add comment");
        handleError(error);
      }
    });

  // --- edit ---
  comment
    .command("edit <id>")
    .description("Update a comment")
    .requiredOption("--body <body>", "Updated comment body")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { body: string; json?: boolean }) => {
      const spinner = ora({ text: "Updating comment...", isSilent: !!opts.json }).start();
      try {
        const client = getClient();
        const data = await client.request<{
          updateComment: {
            id: string;
            body: string;
            author: { login: string; displayName: string };
            createdAt: string;
            updatedAt: string;
          };
        }>(UPDATE_COMMENT, { id, body: opts.body });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.updateComment, null, 2));
          return;
        }

        spinner.succeed("Comment updated");
        const c = data.updateComment;
        console.log();
        console.log(`  ${chalk.bold(`@${c.author.login}`)}  ${chalk.dim(c.updatedAt)}`);
        console.log(`    ${c.body}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to update comment");
        handleError(error);
      }
    });

  // --- delete ---
  comment
    .command("delete <id>")
    .description("Delete a comment")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const spinner = ora({ text: "Deleting comment...", isSilent: !!opts.json }).start();
      try {
        const client = getClient();
        const data = await client.request<{
          deleteComment: { id: string; body: string };
        }>(DELETE_COMMENT, { id });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.deleteComment, null, 2));
          return;
        }

        spinner.succeed("Comment deleted");
        const c = data.deleteComment;
        console.log();
        console.log(`  ${chalk.dim(`#${c.id}`)}  ${c.body}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to delete comment");
        handleError(error);
      }
    });
}
