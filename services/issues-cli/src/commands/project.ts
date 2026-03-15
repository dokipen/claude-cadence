import { Command } from "commander";
import { gql } from "graphql-request";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../client.js";
import { handleError } from "../errors.js";

// --- GraphQL Documents ---

const CREATE_PROJECT = gql`
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) {
      id
      name
      repository
      createdAt
    }
  }
`;

const LIST_PROJECTS = gql`
  query ListProjects {
    projects {
      id
      name
      repository
      createdAt
    }
  }
`;

const GET_PROJECT = gql`
  query GetProject($id: ID!) {
    project(id: $id) {
      id
      name
      repository
      createdAt
      updatedAt
    }
  }
`;

const UPDATE_PROJECT = gql`
  mutation UpdateProject($id: ID!, $input: UpdateProjectInput!) {
    updateProject(id: $id, input: $input) {
      id
      name
      repository
      updatedAt
    }
  }
`;

// --- Commands ---

export function registerProjectCommand(program: Command): void {
  const project = program.command("project").description("Manage projects");

  // --- create ---
  project
    .command("create")
    .description("Create a new project")
    .requiredOption("--name <name>", "Project name")
    .requiredOption("--repository <repository>", "Repository (e.g. org/repo)")
    .option("--json", "Output raw JSON")
    .action(async (opts: { name: string; repository: string; json?: boolean }) => {
      const spinner = ora("Creating project...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          createProject: { id: string; name: string; repository: string; createdAt: string };
        }>(CREATE_PROJECT, { input: { name: opts.name, repository: opts.repository } });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.createProject, null, 2));
          return;
        }

        spinner.succeed("Project created");
        const p = data.createProject;
        console.log();
        console.log(`  ${chalk.bold(`#${p.id}`)}  ${p.name}`);
        console.log(`  Repository: ${chalk.cyan(p.repository)}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to create project");
        handleError(error);
      }
    });

  // --- list ---
  project
    .command("list")
    .description("List all projects")
    .option("--json", "Output raw JSON")
    .action(async (opts: { json?: boolean }) => {
      const spinner = ora("Fetching projects...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          projects: Array<{ id: string; name: string; repository: string; createdAt: string }>;
        }>(LIST_PROJECTS);

        spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify(data.projects, null, 2));
          return;
        }

        if (data.projects.length === 0) {
          console.log(chalk.dim("  No projects found."));
          console.log();
          return;
        }

        console.log();
        for (const p of data.projects) {
          console.log(`  ${chalk.dim(`#${p.id}`)}  ${chalk.bold(p.name)}  ${chalk.cyan(p.repository)}`);
        }
        console.log();
      } catch (error) {
        spinner.fail("Failed to list projects");
        handleError(error);
      }
    });

  // --- view ---
  project
    .command("view <id>")
    .description("View project details")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const spinner = ora("Fetching project...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          project: {
            id: string;
            name: string;
            repository: string;
            createdAt: string;
            updatedAt: string;
          } | null;
        }>(GET_PROJECT, { id });

        spinner.stop();

        const p = data.project;
        if (!p) {
          console.error(chalk.red(`Project #${id} not found`));
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(p, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`  #${p.id}  ${p.name}`));
        console.log(`  Repository: ${chalk.cyan(p.repository)}`);
        console.log(`  Created: ${chalk.dim(p.createdAt)}  Updated: ${chalk.dim(p.updatedAt)}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to fetch project");
        handleError(error);
      }
    });

  // --- update ---
  project
    .command("update <id>")
    .description("Update a project")
    .option("--name <name>", "New name")
    .option("--repository <repository>", "New repository")
    .option("--json", "Output raw JSON")
    .action(async (id: string, opts: { name?: string; repository?: string; json?: boolean }) => {
      const input: Record<string, string> = {};
      if (opts.name) input.name = opts.name;
      if (opts.repository) input.repository = opts.repository;

      if (Object.keys(input).length === 0) {
        console.error(
          chalk.red("Error: At least one field to update must be specified.")
        );
        process.exit(1);
      }

      const spinner = ora("Updating project...").start();
      try {
        const client = getClient();
        const data = await client.request<{
          updateProject: { id: string; name: string; repository: string; updatedAt: string };
        }>(UPDATE_PROJECT, { id, input });

        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data.updateProject, null, 2));
          return;
        }

        spinner.succeed("Project updated");
        const p = data.updateProject;
        console.log();
        console.log(`  ${chalk.bold(`#${p.id}`)}  ${p.name}`);
        console.log(`  Repository: ${chalk.cyan(p.repository)}`);
        console.log();
      } catch (error) {
        spinner.fail("Failed to update project");
        handleError(error);
      }
    });
}
