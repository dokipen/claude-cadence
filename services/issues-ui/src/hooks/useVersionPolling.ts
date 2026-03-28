import { useEffect, useRef, useState } from 'react';
import { usePageVisibility } from './usePageVisibility';

const MAX_BACKOFF_MS = 300_000;

function getBuildSha(): string {
  return typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev';
}

export function useVersionPolling(intervalMs = __VERSION_POLL_INTERVAL_MS__): { updateAvailable: boolean } {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const isHidden = usePageVisibility();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failureCount = useRef(0);

  useEffect(() => {
    if (updateAvailable) return; // stop polling once update is detected

    if (isHidden) {
      // pause when tab is hidden
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    let mounted = true;

    const scheduleNext = (delay: number) => {
      timerRef.current = setTimeout(async () => {
        try {
          const res = await fetch('/version.json');
          if (!mounted) return;
          if (!res.ok) {
            failureCount.current += 1;
            const backoff = Math.min(intervalMs * Math.pow(2, failureCount.current), MAX_BACKOFF_MS);
            scheduleNext(backoff);
            return;
          }
          const data = await res.json() as { sha?: string };
          if (!mounted) return;
          // Reset failure count: if there were prior failures, reset to -1 so the
          // first subsequent failure uses intervalMs (not 2×) as its backoff delay.
          // If there were no prior failures, leave at 0 to preserve normal doubling behavior.
          if (failureCount.current > 0) {
            failureCount.current = -1;
          }
          if (data.sha && data.sha !== getBuildSha()) {
            setUpdateAvailable(true);
          } else {
            scheduleNext(intervalMs);
          }
        } catch {
          if (!mounted) return;
          failureCount.current += 1;
          const backoff = Math.min(intervalMs * Math.pow(2, failureCount.current), MAX_BACKOFF_MS);
          scheduleNext(backoff);
        }
      }, delay);
    };

    scheduleNext(intervalMs);

    return () => {
      mounted = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isHidden, updateAvailable, intervalMs]);

  return { updateAvailable };
}
