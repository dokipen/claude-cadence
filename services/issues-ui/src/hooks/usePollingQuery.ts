import { useState, useEffect, useCallback } from "react";
import { getClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_INTERVAL_MS = 60_000;

interface UsePollingQueryOptions<TResponse, TData> {
  query: string;
  variables: Record<string, unknown> | null;
  transform: (response: TResponse) => TData;
  initialData: TData;
  errorMessage: string;
  intervalMs?: number;
}

interface UsePollingQueryResult<TData> {
  data: TData;
  loading: boolean;
  error: string | null;
}

export function usePollingQuery<TResponse, TData>({
  query,
  variables,
  transform,
  initialData,
  errorMessage,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UsePollingQueryOptions<TResponse, TData>): UsePollingQueryResult<TData> {
  const { logout } = useAuth();
  const [data, setData] = useState<TData>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleAuthFailure = useCallback(() => {
    logout();
  }, [logout]);

  // Serialize variables for stable dependency comparison
  const variablesKey = variables === null ? null : JSON.stringify(variables);

  useEffect(() => {
    if (variablesKey === null) {
      setLoading(false);
      return;
    }

    const parsedVariables = JSON.parse(variablesKey);
    let cancelled = false;
    let isInitialFetch = true;
    let consecutiveFailures = 0;

    const fetchData = () => {
      if (isInitialFetch) {
        setLoading(true);
        setError(null);
      }

      const client = getClient(handleAuthFailure);
      client
        .request<TResponse>(query, parsedVariables)
        .then((result) => {
          if (!cancelled) {
            setData(transform(result));
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
              setError(errorMessage);
            }
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            isInitialFetch = false;
          }
        });
    };

    fetchData();

    const interval = setInterval(fetchData, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [variablesKey, query, transform, errorMessage, intervalMs, handleAuthFailure]);

  return { data, loading, error };
}
