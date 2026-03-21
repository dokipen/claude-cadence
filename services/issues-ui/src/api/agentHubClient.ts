import type { Agent, AgentProfile, AgentStatus } from "../types";

const BASE_PATH = "/api/v1";

export class HubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HubError";
  }
}

/** @internal Use typed endpoint wrappers (e.g. fetchAgents) instead of calling hubFetch directly. */
export async function hubFetch<T>(
  path: string,
  options?: RequestInit,
  validate?: (data: unknown) => T,
): Promise<T> {
  const url = `${BASE_PATH}${path}`;
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> };
  if (options?.body != null) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.error === "string") {
        message = body.error.slice(0, 200);
      }
    } catch {
      // use statusText
    }
    throw new HubError(res.status, message);
  }

  const data = await res.json();

  if (validate) {
    return validate(data);
  }

  return data as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function validateAgentProfile(data: unknown, path: string): AgentProfile {
  if (!isRecord(data)) {
    throw new HubError(502, `Invalid agent profile at ${path}: expected object`);
  }
  if (!isString(data.description)) {
    throw new HubError(502, `Invalid agent profile at ${path}: missing or invalid "description"`);
  }
  const repo = isString(data.repo) ? data.repo : "";
  return { description: data.description, repo };
}

function validateAgent(data: unknown, index: number): Agent {
  if (!isRecord(data)) {
    throw new HubError(502, `Invalid agent at index ${index}: expected object`);
  }
  if (!isString(data.name)) {
    throw new HubError(502, `Invalid agent at index ${index}: missing or invalid "name"`);
  }
  if (data.status !== "online" && data.status !== "offline") {
    throw new HubError(502, `Invalid agent at index ${index}: missing or invalid "status"`);
  }
  if (!isRecord(data.profiles)) {
    throw new HubError(502, `Invalid agent at index ${index}: missing or invalid "profiles"`);
  }
  if (!isString(data.last_seen)) {
    throw new HubError(502, `Invalid agent at index ${index}: missing or invalid "last_seen"`);
  }

  const profiles: Record<string, AgentProfile> = {};
  for (const [key, value] of Object.entries(data.profiles)) {
    const safeKey = key.slice(0, 64).replace(/[^\w-]/g, "_");
    profiles[key] = validateAgentProfile(value, `agents[${index}].profiles.${safeKey}`);
  }

  return {
    name: data.name,
    status: data.status as AgentStatus,
    profiles,
    last_seen: data.last_seen,
  };
}

function validateAgentsResponse(data: unknown): { agents: Agent[] } {
  if (!isRecord(data)) {
    throw new HubError(502, "Invalid response: expected object");
  }
  if (!Array.isArray(data.agents)) {
    throw new HubError(502, 'Invalid response: missing or invalid "agents" array');
  }
  return { agents: data.agents.map(validateAgent) };
}

export async function fetchAgents(): Promise<{ agents: Agent[] }> {
  return hubFetch("/agents", undefined, validateAgentsResponse);
}
