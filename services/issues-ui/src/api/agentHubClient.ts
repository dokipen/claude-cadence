import { fromJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import type { Agent, Session } from "../types";
import { AgentSchema, SessionSchema } from "../gen/hub/v1/hub_pb";

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

function parseAgent(data: unknown, index: number): Agent {
  try {
    // ignoreUnknownFields: server may add new fields before proto is updated
    // Cast to Agent: fromJson returns the generated type (status: string); our
    // exported Agent narrows status to AgentStatus. The cast is intentional —
    // proto3 strings can carry unexpected values at runtime, but we enforce the
    // union at the type level for all downstream consumers.
    return fromJson(AgentSchema, data as JsonValue, { ignoreUnknownFields: true }) as unknown as Agent;
  } catch (e) {
    throw new HubError(502, `Invalid agent at index ${index}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function validateAgentsResponse(data: unknown): { agents: Agent[] } {
  if (!isRecord(data)) {
    throw new HubError(502, "Invalid response: expected object");
  }
  if (!Array.isArray(data.agents)) {
    throw new HubError(502, 'Invalid response: missing or invalid "agents" array');
  }
  return { agents: data.agents.map(parseAgent) };
}

export async function fetchAgents(repo?: string): Promise<{ agents: Agent[] }> {
  const path = repo ? `/agents?repo=${encodeURIComponent(repo)}` : "/agents";
  return hubFetch(path, undefined, validateAgentsResponse);
}

export const VALID_SESSION_STATES = ["creating", "running", "stopped", "error", "destroying"] as const;

function parseSession(data: unknown): Session {
  try {
    // ignoreUnknownFields: server may add new fields before proto is updated
    return fromJson(SessionSchema, data as JsonValue, { ignoreUnknownFields: true });
  } catch (e) {
    throw new HubError(502, `Invalid session response: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface AgentSessions {
  agentName: string;
  sessions: Session[];
}

function validateAllSessionsResponse(data: unknown): AgentSessions[] {
  if (!isRecord(data) || !Array.isArray(data.agents)) {
    throw new HubError(502, 'Invalid sessions response: missing "agents" array');
  }
  return (data.agents as unknown[]).map((entry, i) => {
    if (!isRecord(entry) || typeof entry.agent_name !== "string") {
      throw new HubError(502, `Invalid sessions response: entry ${i} missing agent_name`);
    }
    const sessions = Array.isArray(entry.sessions)
      ? entry.sessions.map((s) => parseSession(s))
      : [];
    return { agentName: entry.agent_name, sessions };
  });
}

export async function fetchAllSessions(): Promise<AgentSessions[]> {
  return hubFetch("/sessions", undefined, validateAllSessionsResponse);
}

export async function fetchSessionOutput(
  agentName: string,
  sessionId: string,
): Promise<string> {
  const resp = await fetch(`/api/v1/agents/${encodeURIComponent(agentName)}/sessions/${encodeURIComponent(sessionId)}/output`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch session output: ${resp.status}`);
  }
  const data = await resp.json();
  return data.output as string;
}

export async function deleteSession(agentName: string, sessionId: string): Promise<void> {
  try {
    await hubFetch(
      `/agents/${encodeURIComponent(agentName)}/sessions/${encodeURIComponent(sessionId)}?force=true`,
      { method: "DELETE" },
    );
  } catch (err) {
    if (err instanceof HubError && err.status === 404) {
      // Session already gone — treat as success
      return;
    }
    throw err;
  }
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
      return parseSession(data.session);
    },
  );
}
