import { describe, it, expect, vi, beforeEach } from "vitest";
import { hubFetch, fetchAgents, createSession, HubError } from "./agentHubClient";

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
}) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: response.statusText ?? "OK",
    json: response.json ?? (() => Promise.resolve({})),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("hubFetch", () => {
  it("returns parsed JSON on success", async () => {
    mockFetch({ json: () => Promise.resolve({ foo: "bar" }) });
    const result = await hubFetch<{ foo: string }>("/test");
    expect(result).toEqual({ foo: "bar" });
  });

  it("prepends /api/v1 to the path", async () => {
    const fn = mockFetch({});
    await hubFetch("/test");
    expect(fn).toHaveBeenCalledWith("/api/v1/test", expect.anything());
  });

  it("sets Content-Type header when body is present", async () => {
    const fn = mockFetch({});
    await hubFetch("/test", { method: "POST", body: JSON.stringify({ x: 1 }) });
    const callHeaders = fn.mock.calls[0][1].headers;
    expect(callHeaders["Content-Type"]).toBe("application/json");
  });

  it("does not set Content-Type header when no body", async () => {
    const fn = mockFetch({});
    await hubFetch("/test");
    const callHeaders = fn.mock.calls[0][1].headers;
    expect(callHeaders["Content-Type"]).toBeUndefined();
  });

  it("throws HubError with body.error on non-OK response", async () => {
    mockFetch({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: () => Promise.resolve({ error: "Agent not found" }),
    });
    const err = await hubFetch("/test").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubError);
    expect(err).toMatchObject({ status: 404, message: "Agent not found" });
  });

  it("truncates long error messages from server", async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: "Error",
      json: () => Promise.resolve({ error: "x".repeat(300) }),
    });
    const err = await hubFetch("/test").catch((e: unknown) => e) as HubError;
    expect(err.message).toHaveLength(200);
  });

  it("preserves caller-supplied headers when body is present", async () => {
    const fn = mockFetch({});
    await hubFetch("/test", {
      method: "POST",
      body: JSON.stringify({ x: 1 }),
      headers: { Authorization: "Bearer token123" } as Record<string, string>,
    });
    const callHeaders = fn.mock.calls[0][1].headers;
    expect(callHeaders["Authorization"]).toBe("Bearer token123");
    expect(callHeaders["Content-Type"]).toBe("application/json");
  });

  it("falls back to statusText when body has no error field", async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({}),
    });
    await expect(hubFetch("/test")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });

  it("falls back to statusText when body JSON parsing fails", async () => {
    mockFetch({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: () => Promise.reject(new Error("not json")),
    });
    await expect(hubFetch("/test")).rejects.toMatchObject({
      status: 502,
      message: "Bad Gateway",
    });
  });

  it("calls validate function when provided", async () => {
    mockFetch({ json: () => Promise.resolve({ raw: true }) });
    const validate = vi.fn().mockReturnValue({ validated: true });
    const result = await hubFetch("/test", undefined, validate);
    expect(validate).toHaveBeenCalledWith({ raw: true });
    expect(result).toEqual({ validated: true });
  });

  it("propagates validation errors", async () => {
    mockFetch({ json: () => Promise.resolve({ bad: "data" }) });
    const validate = () => {
      throw new HubError(502, "Invalid response");
    };
    await expect(hubFetch("/test", undefined, validate)).rejects.toThrow(
      "Invalid response",
    );
  });
});

describe("fetchAgents", () => {
  const validAgent = {
    name: "agent-1",
    status: "online",
    profiles: {
      default: { description: "A profile", repo: "https://github.com/test/repo" },
    },
    last_seen: "2026-03-16T00:00:00Z",
  };

  it("returns validated agents on valid response", async () => {
    mockFetch({ json: () => Promise.resolve({ agents: [validAgent] }) });
    const result = await fetchAgents();
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toEqual(validAgent);
  });

  it("returns empty array when agents is empty", async () => {
    mockFetch({ json: () => Promise.resolve({ agents: [] }) });
    const result = await fetchAgents();
    expect(result.agents).toEqual([]);
  });

  it("strips extra fields from response", async () => {
    const agentWithExtra = { ...validAgent, extraField: "should be stripped" };
    mockFetch({ json: () => Promise.resolve({ agents: [agentWithExtra] }) });
    const result = await fetchAgents();
    expect(result.agents[0]).toEqual(validAgent);
    expect((result.agents[0] as unknown as Record<string, unknown>).extraField).toBeUndefined();
  });

  it("throws HubError when response is not an object", async () => {
    mockFetch({ json: () => Promise.resolve("not an object") });
    await expect(fetchAgents()).rejects.toThrow("Invalid response: expected object");
  });

  it("throws HubError when response is null", async () => {
    mockFetch({ json: () => Promise.resolve(null) });
    await expect(fetchAgents()).rejects.toThrow("Invalid response: expected object");
  });

  it("throws HubError when agents field is missing", async () => {
    mockFetch({ json: () => Promise.resolve({}) });
    await expect(fetchAgents()).rejects.toThrow(
      'Invalid response: missing or invalid "agents" array',
    );
  });

  it("throws HubError when agents is not an array", async () => {
    mockFetch({ json: () => Promise.resolve({ agents: "not array" }) });
    await expect(fetchAgents()).rejects.toThrow(
      'Invalid response: missing or invalid "agents" array',
    );
  });

  it("throws HubError when agent is not an object", async () => {
    mockFetch({ json: () => Promise.resolve({ agents: ["not an object"] }) });
    await expect(fetchAgents()).rejects.toThrow(
      "Invalid agent at index 0: expected object",
    );
  });

  it("throws HubError when agent is null", async () => {
    mockFetch({ json: () => Promise.resolve({ agents: [null] }) });
    await expect(fetchAgents()).rejects.toThrow(
      "Invalid agent at index 0: expected object",
    );
  });

  it("throws HubError when agent.name is missing", async () => {
    mockFetch({
      json: () => Promise.resolve({ agents: [{ ...validAgent, name: undefined }] }),
    });
    await expect(fetchAgents()).rejects.toThrow(
      'Invalid agent at index 0: missing or invalid "name"',
    );
  });

  it("throws HubError when agent.name is not a string", async () => {
    mockFetch({
      json: () => Promise.resolve({ agents: [{ ...validAgent, name: 123 }] }),
    });
    await expect(fetchAgents()).rejects.toThrow(
      'Invalid agent at index 0: missing or invalid "name"',
    );
  });

  it("throws HubError when agent.status is invalid", async () => {
    mockFetch({
      json: () => Promise.resolve({ agents: [{ ...validAgent, status: "unknown" }] }),
    });
    await expect(fetchAgents()).rejects.toThrow(
      'Invalid agent at index 0: missing or invalid "status"',
    );
  });

  it("throws HubError when agent.profiles is missing", async () => {
    mockFetch({
      json: () =>
        Promise.resolve({ agents: [{ ...validAgent, profiles: undefined }] }),
    });
    await expect(fetchAgents()).rejects.toThrow(
      'Invalid agent at index 0: missing or invalid "profiles"',
    );
  });

  it("throws HubError when agent.last_seen is missing", async () => {
    mockFetch({
      json: () =>
        Promise.resolve({ agents: [{ ...validAgent, last_seen: undefined }] }),
    });
    await expect(fetchAgents()).rejects.toThrow(
      'Invalid agent at index 0: missing or invalid "last_seen"',
    );
  });

  it("throws HubError when profile value is not an object", async () => {
    mockFetch({
      json: () =>
        Promise.resolve({
          agents: [{ ...validAgent, profiles: { bad: 42 } }],
        }),
    });
    await expect(fetchAgents()).rejects.toThrow(
      "Invalid agent profile at agents[0].profiles.bad: expected object",
    );
  });

  it("throws HubError when profile.description is missing", async () => {
    mockFetch({
      json: () =>
        Promise.resolve({
          agents: [{ ...validAgent, profiles: { bad: { repo: "r" } } }],
        }),
    });
    await expect(fetchAgents()).rejects.toThrow(
      'Invalid agent profile at agents[0].profiles.bad: missing or invalid "description"',
    );
  });

  it("defaults repo to empty string when missing", async () => {
    mockFetch({
      json: () =>
        Promise.resolve({
          agents: [
            { ...validAgent, profiles: { noRepo: { description: "d" } } },
          ],
        }),
    });
    const result = await fetchAgents();
    expect(result.agents[0].profiles.noRepo.repo).toBe("");
  });

  it("validates multiple agents independently", async () => {
    const agents = [
      validAgent,
      { ...validAgent, name: "agent-2", status: "offline" },
    ];
    mockFetch({ json: () => Promise.resolve({ agents }) });
    const result = await fetchAgents();
    expect(result.agents).toHaveLength(2);
    expect(result.agents[1].name).toBe("agent-2");
    expect(result.agents[1].status).toBe("offline");
  });

  it("uses 502 status code for validation errors", async () => {
    mockFetch({ json: () => Promise.resolve("bad") });
    const err = await fetchAgents().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubError);
    expect(err).toMatchObject({ status: 502 });
  });
});

describe("createSession", () => {
  const validSession = {
    id: "sess-1",
    name: "my-session",
    agent_profile: "default",
    state: "creating",
    tmux_session: "tmux-1",
    created_at: "2026-03-22T00:00:00Z",
    agent_pid: 42,
    worktree_path: "/tmp/work",
    base_ref: "main",
  };

  // Server wraps the session in a {session: {...}} envelope — fix for bug #269
  it("POSTs to correct URL with correct body and returns typed Session", async () => {
    const fn = mockFetch({ json: () => Promise.resolve({ session: validSession }) });
    const result = await createSession("my-agent", "default", "my-session");
    expect(fn).toHaveBeenCalledWith(
      "/api/v1/agents/my-agent/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ agent_profile: "default", session_name: "my-session" }),
      }),
    );
    expect(result).toEqual(validSession);
    expect(result.id).toBe("sess-1");
    expect(result.agent_profile).toBe("default");
  });

  it("includes extra_args in request body when provided", async () => {
    const fn = mockFetch({ json: () => Promise.resolve({ session: validSession }) });
    await createSession("my-agent", "default", "my-session", ["--foo", "--bar"]);
    const sentBody = JSON.parse(fn.mock.calls[0][1].body as string);
    expect(sentBody).toEqual({
      agent_profile: "default",
      session_name: "my-session",
      extra_args: ["--foo", "--bar"],
    });
  });

  it("omits extra_args from request body when not provided", async () => {
    const fn = mockFetch({ json: () => Promise.resolve({ session: validSession }) });
    await createSession("my-agent", "default", "my-session");
    const sentBody = JSON.parse(fn.mock.calls[0][1].body as string);
    expect(sentBody).not.toHaveProperty("extra_args");
  });

  it("URL encodes agent names with special characters", async () => {
    const fn = mockFetch({ json: () => Promise.resolve({ session: validSession }) });
    await createSession("my agent/v2", "default", "my-session");
    const calledUrl = fn.mock.calls[0][0] as string;
    expect(calledUrl).toBe("/api/v1/agents/my%20agent%2Fv2/sessions");
  });

  it("throws HubError on non-OK response", async () => {
    mockFetch({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: () => Promise.resolve({ error: "agent offline" }),
    });
    const err = await createSession("my-agent", "default", "my-session").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HubError);
    expect(err).toMatchObject({ status: 503, message: "agent offline" });
  });

  it("throws HubError with status 502 when response is missing required field id", async () => {
    const { id: _id, ...withoutId } = validSession;
    mockFetch({ json: () => Promise.resolve({ session: withoutId }) });
    const err = await createSession("my-agent", "default", "my-session").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HubError);
    expect(err).toMatchObject({ status: 502 });
  });
});

