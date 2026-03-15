import { createInterface } from "node:readline";
import { Command } from "commander";
import { gql } from "graphql-request";
import chalk from "chalk";
import ora from "ora";
import { getClient } from "../client.js";
import { setAuthToken, clearAuthToken } from "../config.js";
import { handleError } from "../errors.js";

// --- GraphQL Documents ---

const AUTHENTICATE_WITH_PAT = gql`
  mutation AuthenticateWithGitHubPAT($token: String!) {
    authenticateWithGitHubPAT(token: $token) {
      token
      user {
        id
        login
        displayName
        avatarUrl
      }
    }
  }
`;

const AUTHENTICATE_WITH_CODE = gql`
  mutation AuthenticateWithGitHubCode($code: String!) {
    authenticateWithGitHubCode(code: $code) {
      token
      user {
        id
        login
        displayName
        avatarUrl
      }
    }
  }
`;

const ME = gql`
  query Me {
    me {
      id
      githubId
      login
      displayName
      avatarUrl
      createdAt
    }
  }
`;

// --- Types ---

interface AuthPayload {
  token: string;
  user: {
    id: string;
    login: string;
    displayName: string;
    avatarUrl: string | null;
  };
}

interface UserProfile {
  id: string;
  githubId: number;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

// --- Helpers ---

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin });
    const lines: string[] = [];
    rl.on("line", (line) => lines.push(line));
    rl.on("close", () => resolve(lines.join("\n").trim()));
    rl.on("error", (err) => { rl.close(); reject(err); });
  });
}

function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(prompt);
    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim());
    });
    rl.once("error", reject);
  });
}

// --- Command Registration ---

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Authentication commands");

  auth
    .command("login")
    .description("Authenticate with GitHub")
    .option("--pat <token>", "GitHub Personal Access Token")
    .option("--code <code>", "GitHub OAuth authorization code")
    .action(async (options: { pat?: string; code?: string }) => {
      try {
        const client = getClient();
        let result: AuthPayload;

        if (options.pat) {
          const token = options.pat === "-" ? await readStdin() : options.pat;
          if (!token) {
            console.error(chalk.red("Error: no token received from stdin"));
            process.exit(1);
            return;
          }
          const spinner = ora("Authenticating...").start();
          const data = await client.request<{ authenticateWithGitHubPAT: AuthPayload }>(
            AUTHENTICATE_WITH_PAT,
            { token }
          );
          result = data.authenticateWithGitHubPAT;
          setAuthToken(result.token);
          spinner.succeed(`Authenticated as ${chalk.bold(result.user.login)} (${result.user.displayName})`);
        } else if (options.code) {
          const spinner = ora("Authenticating...").start();
          const data = await client.request<{ authenticateWithGitHubCode: AuthPayload }>(
            AUTHENTICATE_WITH_CODE,
            { code: options.code }
          );
          result = data.authenticateWithGitHubCode;
          setAuthToken(result.token);
          spinner.succeed(`Authenticated as ${chalk.bold(result.user.login)} (${result.user.displayName})`);
        } else if (process.stdin.isTTY) {
          const token = await promptSecret("Enter GitHub PAT: ");
          if (!token) {
            console.error(chalk.red("Error: no token provided"));
            process.exit(1);
            return;
          }
          const spinner = ora("Authenticating...").start();
          const data = await client.request<{ authenticateWithGitHubPAT: AuthPayload }>(
            AUTHENTICATE_WITH_PAT,
            { token }
          );
          result = data.authenticateWithGitHubPAT;
          setAuthToken(result.token);
          spinner.succeed(`Authenticated as ${chalk.bold(result.user.login)} (${result.user.displayName})`);
        } else {
          console.error(chalk.red("Error: please provide --pat <token>, --pat - (stdin), or --code <code>"));
          process.exit(1);
          return;
        }
      } catch (error) {
        console.error(chalk.red("Authentication failed"));
        handleError(error);
      }
    });

  auth
    .command("logout")
    .description("Clear stored authentication token")
    .action(() => {
      clearAuthToken();
      console.log("Logged out successfully.");
    });

  auth
    .command("whoami")
    .description("Show current authenticated user")
    .action(async () => {
      const spinner = ora("Fetching user info...").start();

      try {
        const client = getClient();
        const data = await client.request<{ me: UserProfile }>(ME);
        const user = data.me;

        spinner.stop();
        console.log(chalk.bold("Authenticated as:"));
        console.log(`  Login:        ${user.login}`);
        console.log(`  Name:         ${user.displayName}`);
        console.log(`  GitHub ID:    ${user.githubId}`);
        if (user.avatarUrl) {
          console.log(`  Avatar:       ${user.avatarUrl}`);
        }
        console.log(`  Member since: ${new Date(user.createdAt).toLocaleDateString()}`);
      } catch (error) {
        spinner.fail("Failed to fetch user info");
        handleError(error);
      }
    });
}
