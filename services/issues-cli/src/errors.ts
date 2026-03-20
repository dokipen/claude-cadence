import chalk from "chalk";
import { isAuthError, is429Error } from "./client.js";

export function handleError(error: unknown): never {
  if (is429Error(error)) {
    console.error(chalk.red("Rate limit exceeded after retries"));
    console.error(chalk.yellow("The server is rate limiting requests. Please wait and try again."));
  } else if (isAuthError(error)) {
    console.error(chalk.red("Error: Authentication required"));
    console.error(chalk.yellow("Your session has expired. Please re-authenticate:"));
    console.error(chalk.yellow("  issues auth login"));
  } else if (error instanceof Error) {
    const gqlError = error as { response?: { errors?: Array<{ message: string }> } };
    if (gqlError.response?.errors) {
      for (const err of gqlError.response.errors) {
        console.error(chalk.red(`Error: ${err.message}`));
      }
    } else {
      console.error(chalk.red(`Error: ${error.message}`));
    }
  } else {
    console.error(chalk.red("An unexpected error occurred"));
  }

  process.exit(1);
}
