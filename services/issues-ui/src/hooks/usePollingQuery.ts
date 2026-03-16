import { useState, useEffect, useCallback, useRef } from "react";
import { getClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { usePageVisibility } from "./usePageVisibility";

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
  const hidden = usePageVisibility();
  const [data, setData] = useState<TData>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleAuthFailure = useCallback(() => {
    logout();
  }, [logout]);

  const hasFetchedRef = useRef(false);

  // Serialize variables for stable dependency comparison
  const variablesKey = variables === null ? null : JSON.stringify(variables);

  useEffect(() => {
    if (variables === null) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const isInitialFetch = !hasFetchedRef.current;
    let consecutiveFailures = 0;

    const fetchData = () => {
      if (isInitialFetch) {
        setLoading(true);
        setError(null);
      }

      const client = getClient(handleAuthFailure);
      client
        .request<TResponse>(query, variables)
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
            hasFetchedRef.current = true;
          }
        });
    };

    if (hidden) {
      if (isInitialFetch) setLoading(false);
    } else {
      fetchData();
    }

    const interval = hidden ? null : setInterval(fetchData, intervalMs);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [variablesKey, query, transform, errorMessage, intervalMs, handleAuthFailure, hidden]);

  return { data, loading, error };
}
