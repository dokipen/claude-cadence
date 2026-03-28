import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { fetchAllSessions } from "../api/agentHubClient";
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
  optimisticSetDestroying: (sessionId: string) => void;
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
        const agentSessions = await fetchAllSessions();

        if (!cancelled) {
          const results: AgentSession[] = [];
          for (const agent of agentSessions) {
            for (const session of agent.sessions) {
              results.push({ session, agentName: agent.agentName });
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
    () => sessions.filter((s) => s.session.waitingForInput),
    [sessions],
  );

  const optimisticSetDestroying = useCallback((sessionId: string) => {
    setSessions(prev =>
      prev.map(s =>
        s.session.id === sessionId
          ? { ...s, session: { ...s.session, state: "destroying" as const } }
          : s
      )
    );
  }, []);

  return { sessions, waitingSessions, loading, error, optimisticSetDestroying };
}
