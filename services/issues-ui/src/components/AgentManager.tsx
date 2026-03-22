import { useState, useCallback } from "react";
import type { Project } from "../types";
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
        (s) => normalizeRepo(s.session.repo_url) === normalizeRepo(selectedProject.repository)
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

  const handleLaunched = useCallback((_session: Session, _agentName: string) => {
    // The useAllSessions polling will pick up the new session automatically.
  }, []);

  const loading = agentsLoading;

  return (
    <div className={styles.agentManager} data-testid="agent-manager">
      <AgentLaunchForm agents={agents} onLaunched={handleLaunched} />
      <div className={styles.agentManagerBody}>
        <SessionList
          agents={agents}
          sessions={filteredSessions}
          openKeys={new Set([...openKeys, ...minimizedKeys])}
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
            />
          )}
        </div>
      </div>
    </div>
  );
}
