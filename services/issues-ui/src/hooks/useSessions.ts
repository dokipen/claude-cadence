import { useState, useEffect, useRef, useMemo } from "react";
import { hubFetch } from "../api/agentHubClient";
import { usePageVisibility } from "./usePageVisibility";
import type { Agent, Session } from "../types";

const POLL_INTERVAL_MS = 10_000;

export interface AgentSession {
  session: Session;
  agentName: string;
}

interface UseSessionsResult {
  sessions: AgentSession[];
  loading: boolean;
  error: string | null;
}

export function useSessions(agents: Agent[]): UseSessionsResult {
  const hidden = usePageVisibility();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const isInitialFetch = !hasFetchedRef.current;
    let consecutiveFailures = 0;

    const onlineAgents = agents.filter((a) => a.status === "online");

    const pollSessions = async () => {
      if (isInitialFetch) {
        setLoading(true);
        setError(null);
      }

      try {
        const results: AgentSession[] = [];
        await Promise.all(
          onlineAgents.map(async (agent) => {
            try {
              const agentSessions = await hubFetch<Session[]>(
                `/agents/${encodeURIComponent(agent.name)}/sessions`,
              );
              for (const session of agentSessions) {
                results.push({ session, agentName: agent.name });
              }
            } catch {
              // Individual agent may be unreachable, continue
            }
          }),
        );
        if (!cancelled) {
          setSessions(results);
          consecutiveFailures = 0;
          setError(null);
        }
      } catch {
        if (!cancelled) {
          consecutiveFailures++;
          if (isInitialFetch || consecutiveFailures >= 3) {
            setError("Failed to fetch sessions");
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          hasFetchedRef.current = true;
        }
      }
    };

    if (hidden) {
      if (isInitialFetch) setLoading(false);
    } else {
      pollSessions();
    }

    const interval = hidden ? null : setInterval(pollSessions, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [agents, hidden]);

  return { sessions, loading, error };
}
