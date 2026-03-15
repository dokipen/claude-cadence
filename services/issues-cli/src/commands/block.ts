import { Command } from "commander";
import { gql } from "graphql-request";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../client.js";
import { handleError } from "../errors.js";

// --- GraphQL Documents ---

const ADD_BLOCK_RELATION = gql`
  mutation AddBlockRelation($blockerId: ID!, $blockedId: ID!) {
    addBlockRelation(blockerId: $blockerId, blockedId: $blockedId) {
      id
      title
      blockedBy {
        id
        title
        state
      }
    }
  }
`;

const REMOVE_BLOCK_RELATION = gql`
  mutation RemoveBlockRelation($blockerId: ID!, $blockedId: ID!) {
    removeBlockRelation(blockerId: $blockerId, blockedId: $blockedId) {
      id
      title
      blockedBy {
        id
        title
        state
      }
    }
  }
`;

// --- Commands ---

export function registerBlockCommand(program: Command): void {
  const block = program.command("block").description("Manage blocking relationships");

  // --- add ---
  block
    .command("add")
    .description("Add a blocking relationship")
    .requiredOption("--blocker <id>", "Blocker ticket ID")
    .requiredOption("--blocked <id>", "Blocked ticket ID")
    .action(async (opts: { blocker: string; blocked: string }) => {
      const spinner = ora("Adding block relation...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          addBlockRelation: {
            id: string;
            title: string;
            blockedBy: { id: string; title: string; state: string }[];
          };
        }>(ADD_BLOCK_RELATION, { blockerId: opts.blocker, blockedId: opts.blocked });

        spinner.succeed("Block relation added");
        const t = data.addBlockRelation;
        console.log();
        console.log(`  ${chalk.bold(`#${t.id}`)}  ${t.title}`);
        if (t.blockedBy.length > 0) {
          console.log(chalk.bold("  Blocked By:"));
          for (const b of t.blockedBy) {
            console.log(`    #${b.id} ${b.title} (${b.state})`);
          }
        }
        console.log();
      } catch (error) {
        spinner.fail("Failed to add block relation");
        handleError(error);
      }
    });

  // --- remove ---
  block
    .command("remove")
    .description("Remove a blocking relationship")
    .requiredOption("--blocker <id>", "Blocker ticket ID")
    .requiredOption("--blocked <id>", "Blocked ticket ID")
    .action(async (opts: { blocker: string; blocked: string }) => {
      const spinner = ora("Removing block relation...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          removeBlockRelation: {
            id: string;
            title: string;
            blockedBy: { id: string; title: string; state: string }[];
          };
        }>(REMOVE_BLOCK_RELATION, { blockerId: opts.blocker, blockedId: opts.blocked });

        spinner.succeed("Block relation removed");
        const t = data.removeBlockRelation;
        console.log();
        console.log(`  ${chalk.bold(`#${t.id}`)}  ${t.title}`);
        if (t.blockedBy.length > 0) {
          console.log(chalk.bold("  Blocked By:"));
          for (const b of t.blockedBy) {
            console.log(`    #${b.id} ${b.title} (${b.state})`);
          }
        } else {
          console.log(`  ${chalk.dim("No longer blocked")}`);
        }
        console.log();
      } catch (error) {
        spinner.fail("Failed to remove block relation");
        handleError(error);
      }
    });
}
