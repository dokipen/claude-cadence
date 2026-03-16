import { useState, useEffect, useRef, useMemo } from "react";
import { hubFetch } from "../api/agentHubClient";
import { usePageVisibility } from "./usePageVisibility";
import type { Agent, AgentProfile } from "../types";

const POLL_INTERVAL_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 3;

interface UseAgentsResult {
  agents: Agent[];
  loading: boolean;
  error: string | null;
}

export function useAgents(): UseAgentsResult {
  const hidden = usePageVisibility();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const isInitialFetch = !hasFetchedRef.current;
    let consecutiveFailures = 0;

    const fetchAgents = () => {
      if (isInitialFetch) {
        setLoading(true);
        setError(null);
      }

      hubFetch<{ agents: Agent[] }>("/agents")
        .then((result) => {
          if (!cancelled) {
            setAgents(result.agents);
            consecutiveFailures = 0;
            setError(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            consecutiveFailures++;
            if (
              isInitialFetch ||
              consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
            ) {
              setError("Failed to fetch agents");
            }
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            hasFetchedRef.current = true;
          }
        });
    };

    if (hidden) {
      if (isInitialFetch) setLoading(false);
    } else {
      fetchAgents();
    }

    const interval = hidden ? null : setInterval(fetchAgents, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [hidden]);

  return { agents, loading, error };
}

export interface AgentProfileEntry {
  agent: string;
  profileName: string;
  profile: AgentProfile;
}

export function useAgentProfiles(
  repoUrl: string | undefined,
  agents: Agent[],
): AgentProfileEntry[] {
  return useMemo(() => {
    if (!repoUrl) return [];

    const entries: AgentProfileEntry[] = [];
    for (const agent of agents) {
      if (agent.status !== "online") continue;
      for (const [profileName, profile] of Object.entries(agent.profiles)) {
        if (profile.repo === repoUrl) {
          entries.push({ agent: agent.name, profileName, profile });
        }
      }
    }
    return entries;
  }, [agents, repoUrl]);
}
