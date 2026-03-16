import { useState, useEffect, useCallback } from "react";
import type { Project } from "../types";
import { getClient } from "../api/client";
import { PROJECTS_QUERY } from "../api/queries";
import { useAuth } from "../auth/AuthContext";

interface UseProjectsResult {
  projects: Project[];
  loading: boolean;
  error: string | null;
}

export function useProjects(): UseProjectsResult {
  const { logout } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleAuthFailure = useCallback(() => {
    logout();
  }, [logout]);

  useEffect(() => {
    let cancelled = false;

    const fetchProjects = () => {
      const client = getClient(handleAuthFailure);
      client
        .request<{ projects: Project[] }>(PROJECTS_QUERY)
        .then((result) => {
          if (!cancelled) setProjects(result.projects);
        })
        .catch((err) => {
          if (!cancelled)
            setError(
              err instanceof Error ? err.message : "Failed to load projects",
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    fetchProjects();

    const interval = setInterval(fetchProjects, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [handleAuthFailure]);

  return { projects, loading, error };
}
