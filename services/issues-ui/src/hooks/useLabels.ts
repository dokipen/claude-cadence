import { useState, useEffect, useCallback } from "react";
import type { Label } from "../types";
import { getClient } from "../api/client";
import { LABELS_QUERY } from "../api/queries";
import { useAuth } from "../auth/AuthContext";

interface LabelsResponse {
  labels: Label[];
}

export function useLabels() {
  const { logout } = useAuth();
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);

  const handleAuthFailure = useCallback(() => {
    logout();
  }, [logout]);

  useEffect(() => {
    let cancelled = false;

    const client = getClient(handleAuthFailure);
    client
      .request<LabelsResponse>(LABELS_QUERY)
      .then((result) => {
        if (!cancelled) setLabels(result.labels);
      })
      .catch(() => {
        // Labels are non-critical — silently fail
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [handleAuthFailure]);

  return { labels, loading };
}
