import chalk from "chalk";
import { isAuthError } from "./client.js";

export function handleError(error: unknown): never {
  if (isAuthError(error)) {
    console.error(chalk.red("Error: Authentication required"));
    console.error(chalk.yellow("Your session has expired. Please re-authenticate:"));
    console.error(chalk.yellow("  issues auth login"));
    process.exit(1);
  }

  if (error instanceof Error) {
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
