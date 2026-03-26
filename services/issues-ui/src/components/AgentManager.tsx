import { useState, useCallback, useEffect, useRef } from "react";
import type { Project } from "../types";
import { useSearchParams } from "react-router";
import { useAgents, normalizeRepo } from "../hooks/useAgents";
import { SessionList, sessionKey } from "./SessionList";
import { TilingLayout } from "./TilingLayout";
import { AgentLaunchForm } from "./AgentLaunchForm";
import type { TiledWindow } from "./TilingLayout";
import type { AgentSession } from "../hooks/useAllSessions";
import type { Session } from "../types";
import styles from "../styles/agents.module.css";

interface AgentManagerProps {
  sessions: AgentSession[];
  selectedProject?: Project | null;
}

export function AgentManager({ sessions, selectedProject }: AgentManagerProps) {
  const filteredSessions = selectedProject?.repository
    ? sessions.filter(
        (s) => normalizeRepo(s.session.repoUrl) === normalizeRepo(selectedProject.repository)
      )
    : sessions;
  const { agents, loading: agentsLoading } = useAgents();
  const [openWindows, setOpenWindows] = useState<TiledWindow[]>([]);
  const [minimizedKeys, setMinimizedKeys] = useState<Set<string>>(new Set());
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cadence_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("cadence_sidebar_collapsed", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const [searchParams] = useSearchParams();
  const initialSessionKey = searchParams.get("session");
  // useRef (not useState) so the one-shot guard doesn't trigger a re-render.
  // The ref resets if the component is unmounted and remounted, which is fine —
  // the URL param will still be present and the session will re-open.
  const hasAutoOpened = useRef(false);

  // Auto-open the session specified in the ?session= query param (set by notification links).
  // Searches the unfiltered `sessions` prop intentionally: the notification link targets a
  // specific session and should open it regardless of any active project filter.
  useEffect(() => {
    if (hasAutoOpened.current || !initialSessionKey) return;
    const target = sessions.find((s) => sessionKey(s) === initialSessionKey);
    if (!target) return;
    hasAutoOpened.current = true;
    setOpenWindows((prev) => {
      if (prev.some((w) => w.key === initialSessionKey)) return prev;
      return [
        ...prev,
        {
          key: initialSessionKey,
          session: target.session,
          agentName: target.agentName,
          projectId: selectedProject?.id,
        },
      ];
    });
  }, [initialSessionKey, sessions, selectedProject?.id]);

  const openKeys = new Set(openWindows.map((w) => w.key));

  const handleSessionClick = useCallback((as: AgentSession) => {
    const key = sessionKey(as);

    // If minimized, restore it
    if (minimizedKeys.has(key)) {
      setMinimizedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      // Re-add to open windows if not already there
      setOpenWindows((prev) => {
        if (prev.some((w) => w.key === key)) return prev;
        return [...prev, { key, session: as.session, agentName: as.agentName, projectId: selectedProject?.id }];
      });
      return;
    }

    // If already open, do nothing (already visible)
    if (openWindows.some((w) => w.key === key)) return;

    // Open new window
    setOpenWindows((prev) => [
      ...prev,
      { key, session: as.session, agentName: as.agentName, projectId: selectedProject?.id },
    ]);
  }, [openWindows, minimizedKeys, selectedProject]);

  const handleMinimize = useCallback((key: string) => {
    setMinimizedKeys((prev) => new Set(prev).add(key));
    setOpenWindows((prev) => prev.filter((w) => w.key !== key));
  }, []);

  const handleTerminated = useCallback((key: string) => {
    setOpenWindows((prev) => prev.filter((w) => w.key !== key));
    setMinimizedKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const handleReorder = useCallback((dragKey: string, dropKey: string) => {
    setOpenWindows((prev) => {
      const dragIdx = prev.findIndex((w) => w.key === dragKey);
      const dropIdx = prev.findIndex((w) => w.key === dropKey);
      if (dragIdx === -1 || dropIdx === -1 || dragIdx === dropIdx) return prev;
      const next = [...prev];
      [next[dragIdx], next[dropIdx]] = [next[dropIdx], next[dragIdx]];
      return next;
    });
  }, []);

  const handleReorderAll = useCallback((keys: string[]) => {
    setOpenWindows((prev) => {
      const byKey = new Map(prev.map((w) => [w.key, w]));
      const restored = keys.flatMap((k) => {
        const w = byKey.get(k);
        return w ? [w] : [];
      });
      // Keep any windows not in keys (shouldn't happen, but be safe)
      const inKeys = new Set(keys);
      const extras = prev.filter((w) => !inKeys.has(w.key));
      return [...restored, ...extras];
    });
  }, []);

  const handleLaunched = useCallback((_session: Session, _agentName: string) => {
    // The useAllSessions polling will pick up the new session automatically.
  }, []);

  const loading = agentsLoading;

  return (
    <div className={styles.agentManager} data-testid="agent-manager">
      <AgentLaunchForm agents={agents} onLaunched={handleLaunched} repoUrl={selectedProject?.repository} />
      <div className={styles.agentManagerBody}>
        <SessionList
          agents={agents}
          sessions={filteredSessions}
          openKeys={openKeys}
          onSessionClick={handleSessionClick}
          isCollapsed={isCollapsed}
          onToggle={toggleSidebar}
        />
        <div className={styles.tilingContainer}>
          {loading && filteredSessions.length === 0 ? (
            <div className={styles.tilingEmpty} data-testid="tiling-area">
              <p>Loading sessions…</p>
            </div>
          ) : (
            <TilingLayout
              windows={openWindows}
              onMinimize={handleMinimize}
              onTerminated={handleTerminated}
              onReorder={handleReorder}
              onReorderAll={handleReorderAll}
            />
          )}
        </div>
      </div>
    </div>
  );
}
