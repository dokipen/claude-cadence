import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".issues-cli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");

function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

interface ConfigFile {
  apiUrl?: string;
}

interface AuthFile {
  token?: string;
}

function readJsonFile<T>(path: string): T | null {
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function getApiUrl(): string {
  if (process.env.ISSUES_API_URL) {
    return process.env.ISSUES_API_URL;
  }

  const config = readJsonFile<ConfigFile>(CONFIG_FILE);
  if (config?.apiUrl) {
    return config.apiUrl;
  }

  return "http://localhost:4000";
}

export function getAuthToken(): string | undefined {
  if (process.env.ISSUES_AUTH_TOKEN) {
    return process.env.ISSUES_AUTH_TOKEN;
  }

  const auth = readJsonFile<AuthFile>(AUTH_FILE);
  return auth?.token ?? undefined;
}

export function setAuthToken(token: string): void {
  ensureConfigDir();
  const auth: AuthFile = { token };
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
}

export function clearAuthToken(): void {
  if (existsSync(AUTH_FILE)) {
    unlinkSync(AUTH_FILE);
  }
}
