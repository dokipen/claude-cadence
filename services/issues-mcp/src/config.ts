import { execSync } from "node:child_process";

const DEFAULT_API_URL = "http://localhost:4000/graphql";

// Holds the project ID resolved at startup from ISSUES_PROJECT_NAME.
// Avoids mutating process.env with derived state.
let resolvedProjectId: string | undefined;

// In-session cache: project name → CUID
const projectNameCache = new Map<string, string>();

export function getCachedProjectIdByName(name: string): string | undefined {
  return projectNameCache.get(name.trim().toLowerCase());
}

export function cacheProjectIdByName(name: string, id: string): void {
  projectNameCache.set(name.trim().toLowerCase(), id);
}

export function clearProjectNameCache(): void {
  projectNameCache.clear();
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
  // Prefer _resolvedToken when set: it was obtained (or refreshed) at runtime
  // and is always at least as fresh as the env var. This ensures that after a
  // successful re-auth the refreshed token is used for subsequent requests
  // instead of the stale ISSUES_AUTH_TOKEN that triggered the auth failure.
  //
  // Note: mid-session rotation of ISSUES_AUTH_TOKEN via env var is not supported —
  // once _resolvedToken is set, the env var is ignored until the process restarts.
  if (_resolvedToken) return _resolvedToken;
  const envToken = process.env.ISSUES_AUTH_TOKEN;
  if (envToken !== undefined && envToken.trim() !== "") {
    return envToken;
  }
  return undefined;
}

export function getRefreshToken(): string | undefined {
  // Prefer _resolvedRefreshToken when set: same rationale as getAuthToken — it was
  // written by the most recent successful re-auth and is fresher than any static env var.
  if (_resolvedRefreshToken) return _resolvedRefreshToken;
  return process.env.ISSUES_REFRESH_TOKEN || undefined;
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
