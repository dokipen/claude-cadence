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

const GENERATE_OAUTH_STATE = gql`
  mutation GenerateOAuthState {
    generateOAuthState
  }
`;

const AUTHENTICATE_WITH_CODE = gql`
  mutation AuthenticateWithGitHubCode($code: String!, $state: String!) {
    authenticateWithGitHubCode(code: $code, state: $state) {
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

// --- Command Registration ---

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Authentication commands");

  auth
    .command("login")
    .description("Authenticate with GitHub")
    .option("--pat <token>", "GitHub Personal Access Token")
    .option("--code <code>", "GitHub OAuth authorization code")
    .action(async (options: { pat?: string; code?: string }) => {
      const spinner = ora("Authenticating...").start();

      try {
        const client = getClient();
        let result: AuthPayload;

        if (options.pat) {
          const data = await client.request<{ authenticateWithGitHubPAT: AuthPayload }>(
            AUTHENTICATE_WITH_PAT,
            { token: options.pat }
          );
          result = data.authenticateWithGitHubPAT;
        } else if (options.code) {
          const stateData = await client.request<{ generateOAuthState: string }>(
            GENERATE_OAUTH_STATE
          );
          const state = stateData.generateOAuthState;
          const data = await client.request<{ authenticateWithGitHubCode: AuthPayload }>(
            AUTHENTICATE_WITH_CODE,
            { code: options.code, state }
          );
          result = data.authenticateWithGitHubCode;
        } else {
          spinner.fail("Please provide --pat <token> or --code <code>");
          process.exit(1);
          return;
        }

        setAuthToken(result.token);
        spinner.succeed(`Authenticated as ${chalk.bold(result.user.login)} (${result.user.displayName})`);
      } catch (error) {
        spinner.fail("Authentication failed");
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
