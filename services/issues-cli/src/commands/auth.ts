import { createInterface } from "node:readline";
import { Command } from "commander";
import { gql } from "graphql-request";
import chalk from "chalk";
import ora from "ora";
import { GraphQLClient } from "graphql-request";
import { getClient } from "../client.js";
import { setAuthTokens, clearAuthToken, getRefreshToken, getApiUrl } from "../config.js";
import { handleError } from "../errors.js";

// --- GraphQL Documents ---

const AUTHENTICATE_WITH_PAT = gql`
  mutation AuthenticateWithGitHubPAT($token: String!) {
    authenticateWithGitHubPAT(token: $token) {
      token
      refreshToken
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
      refreshToken
      user {
        id
        login
        displayName
        avatarUrl
      }
    }
  }
`;

const LOGOUT = gql`
  mutation Logout($refreshToken: String!) {
    logout(refreshToken: $refreshToken)
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
  refreshToken: string;
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
    process.stderr.write(prompt);
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    // Suppress echo so the PAT is not visible on screen
    (rl as unknown as { output: { write: () => void } }).output.write = () => {};
    rl.once("line", (line) => {
      rl.close();
      process.stderr.write("\n");
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
          if (options.pat !== "-") {
            console.error(chalk.yellow(
              "Warning: passing a token directly via --pat <token> is deprecated (exposes token in shell history and process list).\n" +
              "  Use instead: issues auth login --pat -  (reads from stdin)\n" +
              "  Or run without arguments for an interactive prompt."
            ));
          }
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
          setAuthTokens(result.token, result.refreshToken);
          spinner.succeed(`Authenticated as ${chalk.bold(result.user.login)} (${result.user.displayName})`);
        } else if (options.code) {
          if (options.code !== "-") {
            console.error(chalk.yellow(
              "Warning: passing a code directly via --code <code> is deprecated (exposes code in shell history and process list).\n" +
              "  Use instead: issues auth login --code -  (reads from stdin)"
            ));
          }
          const code = options.code === "-" ? await readStdin() : options.code.trim();
          if (!code) {
            console.error(chalk.red("Error: no code received from stdin"));
            process.exit(1);
            return;
          }
          const spinner = ora("Authenticating...").start();
          const stateData = await client.request<{ generateOAuthState: string }>(
            GENERATE_OAUTH_STATE
          );
          const state = stateData.generateOAuthState;
          const data = await client.request<{ authenticateWithGitHubCode: AuthPayload }>(
            AUTHENTICATE_WITH_CODE,
            { code, state }
          );
          result = data.authenticateWithGitHubCode;
          setAuthTokens(result.token, result.refreshToken);
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
          setAuthTokens(result.token, result.refreshToken);
          spinner.succeed(`Authenticated as ${chalk.bold(result.user.login)} (${result.user.displayName})`);
        } else {
          console.error(chalk.red("Error: please provide --pat <token>, --pat - (stdin), --code <code>, or --code - (stdin)"));
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
    .description("Revoke session and clear stored tokens")
    .action(async () => {
      // Try to revoke the refresh token on the server
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        try {
          const client = new GraphQLClient(getApiUrl());
          await client.request(LOGOUT, { refreshToken });
        } catch {
          // Best-effort server-side revocation — continue with local cleanup
        }
      }

      clearAuthToken();
      console.log("Logged out successfully.");
    });

  const whoamiAction = async () => {
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
  };

  auth
    .command("whoami")
    .description("Show current authenticated user")
    .action(whoamiAction);

  // Hidden alias for whoami (agents frequently guess "auth status")
  auth
    .command("status", { hidden: true })
    .action(whoamiAction);
}
