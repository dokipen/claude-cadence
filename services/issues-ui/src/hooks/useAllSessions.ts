import { useState, useEffect, useRef, useMemo } from "react";
import { hubFetch } from "../api/agentHubClient";
import { usePageVisibility } from "./usePageVisibility";
import type { Session } from "../types";

const POLL_INTERVAL_MS = 10_000;

export interface AgentSession {
  session: Session;
  agentName: string;
}

interface UseAllSessionsResult {
  sessions: AgentSession[];
  waitingSessions: AgentSession[];
  loading: boolean;
  error: string | null;
}

export function useAllSessions(): UseAllSessionsResult {
  const hidden = usePageVisibility();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let failures = 0;
    const isInitialFetch = !hasFetchedRef.current;

    const poll = async () => {
      if (isInitialFetch) {
        setLoading(true);
        setError(null);
      }

      try {
        const data = await hubFetch<{
          agents: { agent_name: string; sessions: Session[] }[];
        }>("/sessions");

        if (!cancelled) {
          const results: AgentSession[] = [];
          for (const agent of data.agents || []) {
            for (const session of agent.sessions || []) {
              results.push({ session, agentName: agent.agent_name });
            }
          }
          setSessions(results);
          failures = 0;
          setError(null);
        }
      } catch {
        if (!cancelled) {
          failures++;
          if (isInitialFetch || failures >= 3) {
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
      poll();
    }

    const interval = hidden ? null : setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [hidden]);

  const waitingSessions = useMemo(
    () => sessions.filter((s) => s.session.waiting_for_input),
    [sessions],
  );

  return { sessions, waitingSessions, loading, error };
}
