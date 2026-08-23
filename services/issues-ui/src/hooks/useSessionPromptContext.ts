import { useState, useEffect } from "react";
import { fetchSession } from "../api/agentHubClient";

export interface UseSessionPromptContextResult {
  promptContext: string | undefined;
  promptType: string | undefined;
  loading: boolean;
  error: string | null;
}

const IDLE: UseSessionPromptContextResult = {
  promptContext: undefined,
  promptType: undefined,
  loading: false,
  error: null,
};

/**
 * Fetch promptContext/promptType for a single session on demand.
 *
 * The bulk session list (GET /api/v1/sessions) is metadata-only (issue #685):
 * it carries waitingForInput and idleSince but not the prompt payload. This
 * hook fetches the full session only while `enabled` (i.e. the session is
 * waiting for input) and refetches when `idleSince` changes — a new prompt on
 * the same session produces a new idleSince, so the bulk poll drives refreshes.
 * The hook does no polling of its own.
 */
export function useSessionPromptContext(
  agentName: string,
  sessionId: string,
  enabled: boolean,
  idleSince: string | undefined,
): UseSessionPromptContextResult {
  const [result, setResult] = useState<UseSessionPromptContextResult>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setResult(IDLE);
      return;
    }

    let cancelled = false;
    setResult({ ...IDLE, loading: true });

    fetchSession(agentName, sessionId)
      .then((session) => {
        if (cancelled) return;
        setResult({
          promptContext: session.promptContext,
          promptType: session.promptType,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult({
          ...IDLE,
          error: err instanceof Error ? err.message : "Failed to load prompt",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [agentName, sessionId, enabled, idleSince]);

  return result;
}
