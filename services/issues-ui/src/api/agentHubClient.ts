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
    return fromJson(AgentSchema, data as JsonValue, { ignoreUnknownFields: true });
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

export async function fetchAgents(): Promise<{ agents: Agent[] }> {
  return hubFetch("/agents", undefined, validateAgentsResponse);
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
