import { Command } from "commander";
import { gql } from "graphql-request";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../client.js";
import { handleError } from "../errors.js";

// --- GraphQL Documents ---

const CREATE_LABEL = gql`
  mutation CreateLabel($name: String!, $color: String!) {
    createLabel(name: $name, color: $color) {
      id
      name
      color
      createdAt
    }
  }
`;

const LIST_LABELS = gql`
  query ListLabels {
    labels {
      id
      name
      color
      createdAt
    }
  }
`;

const ADD_LABEL = gql`
  mutation AddLabel($ticketId: ID!, $labelId: ID!) {
    addLabel(ticketId: $ticketId, labelId: $labelId) {
      id
      title
      labels {
        id
        name
      }
    }
  }
`;

const REMOVE_LABEL = gql`
  mutation RemoveLabel($ticketId: ID!, $labelId: ID!) {
    removeLabel(ticketId: $ticketId, labelId: $labelId) {
      id
      title
      labels {
        id
        name
      }
    }
  }
`;

// --- Commands ---

export function registerLabelCommand(program: Command): void {
  const label = program.command("label").description("Manage labels");

  // --- create ---
  label
    .command("create")
    .description("Create a new label")
    .requiredOption("--name <name>", "Label name")
    .requiredOption("--color <color>", "Label color (hex, e.g. #ff0000)")
    .action(async (opts: { name: string; color: string }) => {
      const spinner = ora("Creating label...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          createLabel: { id: string; name: string; color: string; createdAt: string };
        }>(CREATE_LABEL, { name: opts.name, color: opts.color });

        spinner.succeed("Label created");
        const l = data.createLabel;
        console.log();
        console.log(`  ${chalk.bold(`#${l.id}`)}  ${chalk.hex(l.color)(l.name)}  ${chalk.dim(l.color)}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to create label");
        handleError(error);
      }
    });

  // --- list ---
  label
    .command("list")
    .description("List all labels")
    .action(async () => {
      const spinner = ora("Fetching labels...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          labels: Array<{ id: string; name: string; color: string; createdAt: string }>;
        }>(LIST_LABELS);

        spinner.stop();

        if (data.labels.length === 0) {
          console.log(chalk.dim("  No labels found."));
          console.log();
          return;
        }

        console.log();
        for (const l of data.labels) {
          console.log(`  ${chalk.dim(`#${l.id}`)}  ${chalk.hex(l.color)(l.name)}  ${chalk.dim(l.color)}`);
        }
        console.log();
      } catch (error) {
        spinner.fail("Failed to list labels");
        handleError(error);
      }
    });

  // --- add ---
  label
    .command("add <ticket-id>")
    .description("Add a label to a ticket")
    .requiredOption("--label <id>", "Label ID")
    .action(async (ticketId: string, opts: { label: string }) => {
      const spinner = ora("Adding label...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          addLabel: { id: string; title: string; labels: Array<{ id: string; name: string }> };
        }>(ADD_LABEL, { ticketId, labelId: opts.label });

        spinner.succeed("Label added");
        const t = data.addLabel;
        console.log();
        console.log(`  ${chalk.bold(`#${t.id}`)}  ${t.title}`);
        console.log(`  Labels: ${t.labels.map((l) => l.name).join(", ")}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to add label");
        handleError(error);
      }
    });

  // --- remove ---
  label
    .command("remove <ticket-id>")
    .description("Remove a label from a ticket")
    .requiredOption("--label <id>", "Label ID")
    .action(async (ticketId: string, opts: { label: string }) => {
      const spinner = ora("Removing label...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          removeLabel: { id: string; title: string; labels: Array<{ id: string; name: string }> };
        }>(REMOVE_LABEL, { ticketId, labelId: opts.label });

        spinner.succeed("Label removed");
        const t = data.removeLabel;
        console.log();
        console.log(`  ${chalk.bold(`#${t.id}`)}  ${t.title}`);
        console.log(`  Labels: ${t.labels.length > 0 ? t.labels.map((l) => l.name).join(", ") : chalk.dim("none")}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to remove label");
        handleError(error);
      }
    });
}
