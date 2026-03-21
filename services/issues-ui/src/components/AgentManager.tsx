import { useState, useCallback } from "react";
import { useAgents } from "../hooks/useAgents";
import { SessionList, sessionKey } from "./SessionList";
import { TilingLayout } from "./TilingLayout";
import type { TiledWindow } from "./TilingLayout";
import type { AgentSession } from "../hooks/useAllSessions";
import styles from "../styles/agents.module.css";

interface AgentManagerProps {
  sessions: AgentSession[];
}

export function AgentManager({ sessions }: AgentManagerProps) {
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
        return [...prev, { key, session: as.session, agentName: as.agentName }];
      });
      return;
    }

    // If already open, do nothing (already visible)
    if (openWindows.some((w) => w.key === key)) return;

    // Open new window
    setOpenWindows((prev) => [
      ...prev,
      { key, session: as.session, agentName: as.agentName },
    ]);
  }, [openWindows, minimizedKeys]);

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

  const loading = agentsLoading;

  return (
    <div className={styles.agentManager} data-testid="agent-manager">
      <SessionList
        agents={agents}
        sessions={sessions}
        openKeys={new Set([...openKeys, ...minimizedKeys])}
        onSessionClick={handleSessionClick}
        isCollapsed={isCollapsed}
        onToggle={toggleSidebar}
      />
      <div className={styles.tilingContainer}>
        {loading && sessions.length === 0 ? (
          <div className={styles.tilingEmpty} data-testid="tiling-area">
            <p>Loading sessions…</p>
          </div>
        ) : (
          <TilingLayout
            windows={openWindows}
            onMinimize={handleMinimize}
            onTerminated={handleTerminated}
          />
        )}
      </div>
    </div>
  );
}
