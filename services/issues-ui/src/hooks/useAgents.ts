import { useState, useEffect, useRef, useMemo } from "react";
import { fetchAgents } from "../api/agentHubClient";
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

    const pollAgents = () => {
      if (isInitialFetch) {
        setLoading(true);
        setError(null);
      }

      fetchAgents()
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
      pollAgents();
    }

    const interval = hidden ? null : setInterval(pollAgents, POLL_INTERVAL_MS);
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

/** Extract "owner/repo" slug from any GitHub repo reference. */
function normalizeRepo(repo: string): string {
  return repo
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
}

export function useAgentProfiles(
  repoUrl: string | undefined,
  agents: Agent[],
): AgentProfileEntry[] {
  return useMemo(() => {
    if (!repoUrl) return [];

    const normalizedUrl = normalizeRepo(repoUrl);
    const entries: AgentProfileEntry[] = [];
    for (const agent of agents) {
      if (agent.status !== "online") continue;
      for (const [profileName, profile] of Object.entries(agent.profiles)) {
        if (normalizeRepo(profile.repo) === normalizedUrl) {
          entries.push({ agent: agent.name, profileName, profile });
        }
      }
    }
    return entries;
  }, [agents, repoUrl]);
}
