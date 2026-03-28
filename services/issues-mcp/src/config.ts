const DEFAULT_API_URL = "http://localhost:4000/graphql";

// Holds the project ID resolved at startup from ISSUES_PROJECT_NAME.
// Avoids mutating process.env with derived state.
let resolvedProjectId: string | undefined;

export function setResolvedProjectId(id: string): void {
  resolvedProjectId = id;
}

export function getApiUrl(): string {
  return process.env.ISSUES_API_URL ?? DEFAULT_API_URL;
}

export function getAuthToken(): string | undefined {
  const token = process.env.ISSUES_AUTH_TOKEN;
  if (token !== undefined && token.trim() === "") {
    return undefined;
  }
  return token;
}

export function getDefaultProjectId(): string | undefined {
  return resolvedProjectId ?? process.env.ISSUES_PROJECT_ID;
}

export function getDefaultProjectName(): string | undefined {
  return process.env.ISSUES_PROJECT_NAME;
}
