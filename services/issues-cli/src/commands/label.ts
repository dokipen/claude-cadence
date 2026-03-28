import { Command } from "commander";
import { gql } from "graphql-request";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../client.js";
import { handleError } from "../errors.js";
import { resolveLabelId } from "../resolve-label.js";
import { resolveTicketId } from "../resolve-ticket.js";

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

const DELETE_LABEL = gql`
  mutation DeleteLabel($id: ID!) {
    deleteLabel(id: $id) {
      id
      name
      color
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
    .option("--json", "Output raw JSON")
    .option("--project <id>", "Project name or ID (ignored — labels are global)")
    .action(async (opts: { name: string; color: string; json?: boolean; project?: string }) => {
      const spinner = ora({ text: "Creating label...", isSilent: !!opts.json }).start();
      try {
        const client = getClient();
        const data = await client.request<{
          createLabel: { id: string; name: string; color: string; createdAt: string };
        }>(CREATE_LABEL, { name: opts.name, color: opts.color });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.createLabel, null, 2));
          return;
        }

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
    .option("--json", "Output raw JSON")
    .option("--project <id>", "Project name or ID (ignored — labels are global)")
    .action(async (opts: { json?: boolean; project?: string }) => {
      const spinner = ora({ text: "Fetching labels...", isSilent: !!opts.json }).start();
      try {
        const client = getClient();
        const data = await client.request<{
          labels: Array<{ id: string; name: string; color: string; createdAt: string }>;
        }>(LIST_LABELS);

        spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify(data.labels, null, 2));
          return;
        }

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
    .option("--project <id>", "Project ID (required when using ticket number)")
    .requiredOption("--label <name-or-id>", "Label name or ID")
    .option("--json", "Output raw JSON")
    .action(async (ticketId: string, opts: { label: string; project?: string; json?: boolean }) => {
      const spinner = ora({ text: "Adding label...", isSilent: !!opts.json }).start();
      try {
        const [resolvedId, labelId] = await Promise.all([
          resolveTicketId(ticketId, opts.project),
          resolveLabelId(opts.label),
        ]);
        const client = getClient();
        const data = await client.request<{
          addLabel: { id: string; title: string; labels: Array<{ id: string; name: string }> };
        }>(ADD_LABEL, { ticketId: resolvedId, labelId });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.addLabel, null, 2));
          return;
        }

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
    .option("--project <id>", "Project ID (required when using ticket number)")
    .requiredOption("--label <name-or-id>", "Label name or ID")
    .option("--json", "Output raw JSON")
    .action(async (ticketId: string, opts: { label: string; project?: string; json?: boolean }) => {
      const spinner = ora({ text: "Removing label...", isSilent: !!opts.json }).start();
      try {
        const [resolvedId, labelId] = await Promise.all([
          resolveTicketId(ticketId, opts.project),
          resolveLabelId(opts.label),
        ]);
        const client = getClient();
        const data = await client.request<{
          removeLabel: { id: string; title: string; labels: Array<{ id: string; name: string }> };
        }>(REMOVE_LABEL, { ticketId: resolvedId, labelId });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.removeLabel, null, 2));
          return;
        }

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

  // --- delete ---
  label
    .command("delete <name-or-id>")
    .description("Delete a label (removes it from all tickets)")
    .option("--json", "Output raw JSON")
    .option("--project <id>", "Project name or ID (ignored — labels are global)")
    .action(async (nameOrId: string, opts: { json?: boolean; project?: string }) => {
      const spinner = ora({ text: "Deleting label...", isSilent: !!opts.json }).start();
      try {
        const labelId = await resolveLabelId(nameOrId);
        const client = getClient();
        const data = await client.request<{
          deleteLabel: { id: string; name: string; color: string };
        }>(DELETE_LABEL, { id: labelId });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.deleteLabel, null, 2));
          return;
        }

        spinner.succeed("Label deleted");
        const l = data.deleteLabel;
        console.log();
        console.log(`  ${chalk.dim(`#${l.id}`)}  ${chalk.hex(l.color)(l.name)}  ${chalk.dim(l.color)}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to delete label");
        handleError(error);
      }
    });
}
