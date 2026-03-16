import { useState, useEffect, useRef } from "react";
import { hubFetch } from "../api/agentHubClient";
import { usePageVisibility } from "./usePageVisibility";
import type { Session } from "../types";

const POLL_INTERVAL_MS = 10_000;

export interface WaitingSession {
  session: Session;
  agentName: string;
}

interface UseWaitingSessionsResult {
  waitingSessions: WaitingSession[];
  loading: boolean;
}

export function useWaitingSessions(): UseWaitingSessionsResult {
  const hidden = usePageVisibility();
  const [waitingSessions, setWaitingSessions] = useState<WaitingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const isInitialFetch = !hasFetchedRef.current;

    const poll = async () => {
      if (isInitialFetch) setLoading(true);

      try {
        const data = await hubFetch<{
          agents: { agent_name: string; sessions: Session[] }[];
        }>("/sessions?waiting_for_input=true");

        if (!cancelled) {
          const results: WaitingSession[] = [];
          for (const agent of data.agents || []) {
            for (const session of agent.sessions || []) {
              results.push({ session, agentName: agent.agent_name });
            }
          }
          setWaitingSessions(results);
        }
      } catch {
        // Silently fail — badge just won't show
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

  return { waitingSessions, loading };
}
