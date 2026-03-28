const DEFAULT_API_URL = "http://localhost:4000/graphql";

export function getApiUrl(): string {
  return process.env.ISSUES_API_URL ?? DEFAULT_API_URL;
}

export function getAuthToken(): string | undefined {
  return process.env.ISSUES_AUTH_TOKEN;
}

export function getDefaultProjectId(): string | undefined {
  return process.env.ISSUES_PROJECT_ID;
}

export function getDefaultProjectName(): string | undefined {
  return process.env.ISSUES_PROJECT_NAME;
}
