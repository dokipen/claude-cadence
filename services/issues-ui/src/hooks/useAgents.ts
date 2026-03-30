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

export function useAgents(repo?: string): UseAgentsResult {
  const hidden = usePageVisibility();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let consecutiveFailures = 0;

    const pollAgents = () => {
      const isInitialFetch = !hasFetchedRef.current;
      if (isInitialFetch) {
        setLoading(true);
        setError(null);
      }

      fetchAgents(repo)
        .then((result) => {
          if (!cancelled) {
            const sortedAgents = [...result.agents].sort((a, b) =>
              a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
            );
            setAgents(sortedAgents);
            consecutiveFailures = 0;
            setError(null);
          }
        })        .catch(() => {
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
      if (!hasFetchedRef.current) setLoading(false);
    } else {
      pollAgents();
    }

    const interval = hidden ? null : setInterval(pollAgents, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [hidden, repo]);

  return { agents, loading, error };
}

export interface AgentProfileEntry {
  agent: string;
  profileName: string;
  profile: AgentProfile;
}

/**
 * Extract "owner/repo" slug from a GitHub repo reference.
 *
 * Handles:
 * - HTTPS:  https://github.com/owner/repo[.git]
 * - HTTP:   http://github.com/owner/repo[.git]
 * - SSH:    git@github.com:owner/repo[.git]
 *
 * Non-GitHub hosts are returned as-is (minus any trailing .git).
 *
 * @returns A plain "owner/repo" slug for GitHub URLs, or the input (minus
 *   .git) for other inputs. Do not render the return value as HTML or use it
 *   as a URL without further validation.
 */
export function normalizeRepo(repo: string | undefined): string {
  if (!repo) return "";
  return repo
    .replace(/^git@github\.com:/, "") // SSH: git@github.com:owner/repo
    .replace(/^https?:\/\/github\.com\//, "") // HTTPS/HTTP: https://github.com/owner/repo
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
        if (profile.type === "shell") continue;
        if (!profile.repo || normalizeRepo(profile.repo) === normalizedUrl) {
          entries.push({ agent: agent.name, profileName, profile });
        }
      }
    }
    return entries;
  }, [agents, repoUrl]);
}
