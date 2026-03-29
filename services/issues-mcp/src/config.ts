import { execSync } from "node:child_process";

const DEFAULT_API_URL = "http://localhost:4000/graphql";

// Holds the project ID resolved at startup from ISSUES_PROJECT_NAME.
// Avoids mutating process.env with derived state.
let resolvedProjectId: string | undefined;

// In-session cache: project name → CUID
const projectNameCache = new Map<string, string>();

export function getCachedProjectIdByName(name: string): string | undefined {
  return projectNameCache.get(name);
}

export function cacheProjectIdByName(name: string, id: string): void {
  projectNameCache.set(name, id);
}

// In-memory token cache (set at startup or after refresh)
let _resolvedToken: string | undefined;
let _resolvedRefreshToken: string | undefined;

export function setResolvedProjectId(id: string): void {
  resolvedProjectId = id;
}

export function setResolvedAuthToken(token: string): void {
  _resolvedToken = token;
}

export function setResolvedRefreshToken(token: string): void {
  _resolvedRefreshToken = token;
}

export function getApiUrl(): string {
  return process.env.ISSUES_API_URL ?? DEFAULT_API_URL;
}

export function getAuthToken(): string | undefined {
  const envToken = process.env.ISSUES_AUTH_TOKEN;
  if (envToken !== undefined && envToken.trim() !== "") {
    return envToken;
  }
  return _resolvedToken;
}

export function getRefreshToken(): string | undefined {
  return process.env.ISSUES_REFRESH_TOKEN || _resolvedRefreshToken;
}

export function getDefaultProjectId(): string | undefined {
  return resolvedProjectId ?? process.env.ISSUES_PROJECT_ID;
}

export function getDefaultProjectName(): string | undefined {
  return process.env.ISSUES_PROJECT_NAME;
}

export function getGhPat(): string | undefined {
  try {
    // Safety: the command string is a constant — never interpolate user input here,
    // as that would create a command injection vector.
    const token = execSync("gh auth token", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}
