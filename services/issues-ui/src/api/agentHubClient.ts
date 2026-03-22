import type { Agent, AgentProfile, AgentStatus, Session, SessionState } from "../types";

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

const VALID_SESSION_STATES: SessionState[] = ["creating", "running", "stopped", "error", "destroying"];

function validateSessionResponse(data: unknown): Session {
  if (!isRecord(data)) {
    throw new HubError(502, "Invalid session response: expected object");
  }
  if (!isString(data.id)) {
    throw new HubError(502, 'Invalid session response: missing or invalid "id"');
  }
  if (!isString(data.name)) {
    throw new HubError(502, 'Invalid session response: missing or invalid "name"');
  }
  if (!isString(data.agent_profile)) {
    throw new HubError(502, 'Invalid session response: missing or invalid "agent_profile"');
  }
  if (!VALID_SESSION_STATES.includes(data.state as SessionState)) {
    throw new HubError(502, 'Invalid session response: missing or invalid "state"');
  }
  if (!isString(data.tmux_session)) {
    throw new HubError(502, 'Invalid session response: missing or invalid "tmux_session"');
  }
  if (!isString(data.created_at)) {
    throw new HubError(502, 'Invalid session response: missing or invalid "created_at"');
  }
  if (typeof data.agent_pid !== "number") {
    throw new HubError(502, 'Invalid session response: missing or invalid "agent_pid"');
  }
  if (!isString(data.base_ref)) {
    throw new HubError(502, 'Invalid session response: missing or invalid "base_ref"');
  }
  return {
    id: data.id,
    name: data.name,
    agent_profile: data.agent_profile,
    state: data.state as SessionState,
    tmux_session: data.tmux_session,
    created_at: data.created_at,
    agent_pid: data.agent_pid,
    base_ref: data.base_ref,
    ...(isString(data.stopped_at) ? { stopped_at: data.stopped_at } : {}),
    ...(isString(data.error_message) ? { error_message: data.error_message } : {}),
    ...(isString(data.repo_url) ? { repo_url: data.repo_url } : {}),
    ...(typeof data.waiting_for_input === "boolean" ? { waiting_for_input: data.waiting_for_input } : {}),
    ...(isString(data.idle_since) ? { idle_since: data.idle_since } : {}),
  };
}

export async function createSession(
  agentName: string,
  profile: string,
  sessionName: string,
  extraArgs?: string[],
): Promise<Session> {
  const body: Record<string, unknown> = {
    agent_profile: profile,
    session_name: sessionName,
    ...(extraArgs ? { extra_args: extraArgs } : {}),
  };
  return hubFetch(
    `/agents/${encodeURIComponent(agentName)}/sessions`,
    { method: "POST", body: JSON.stringify(body) },
    (data) => {
      if (!isRecord(data) || !isRecord(data.session)) {
        throw new HubError(502, 'Invalid session response: expected object with "session" key');
      }
      return validateSessionResponse(data.session);
    },
  );
}
