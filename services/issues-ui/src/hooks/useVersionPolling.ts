import { useEffect, useRef, useState } from 'react';
import { usePageVisibility } from './usePageVisibility';

function getBuildSha(): string {
  return typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev';
}

export function useVersionPolling(intervalMs = 300_000): { updateAvailable: boolean } {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const isHidden = usePageVisibility();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (updateAvailable) return; // stop polling once update is detected

    const check = async () => {
      try {
        const res = await fetch('/version.json');
        if (!res.ok) return;
        const data = await res.json() as { sha?: string };
        if (data.sha && data.sha !== getBuildSha()) {
          setUpdateAvailable(true);
        }
      } catch {
        // silently ignore
      }
    };

    if (isHidden) {
      // pause when tab is hidden
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(check, intervalMs);
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isHidden, updateAvailable, intervalMs]);

  return { updateAvailable };
}
