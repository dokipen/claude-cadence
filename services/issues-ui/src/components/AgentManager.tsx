import { useState, useCallback, useEffect, useRef } from "react";
import type { Project } from "../types";
import { useSearchParams } from "react-router";
import { useAgents, normalizeRepo } from "../hooks/useAgents";
import { SessionList, sessionKey } from "./SessionList";
import { TilingLayout } from "./TilingLayout";
import { AgentLaunchForm } from "./AgentLaunchForm";
import { useSessionsContext } from "../hooks/SessionsContext";
import { useIsMobile } from "../hooks/useIsMobile";
import type { TiledWindow } from "./TilingLayout";
import type { AgentSession } from "../hooks/useAllSessions";
import type { Session } from "../types";
import styles from "../styles/agents.module.css";

interface AgentManagerProps {
  sessions: AgentSession[];
  sessionsLoaded: boolean;
  selectedProject?: Project | null;
}

export function AgentManager({ sessions, sessionsLoaded, selectedProject }: AgentManagerProps) {
  const filteredSessions = selectedProject?.repository
    ? sessions.filter(
        (s) => normalizeRepo(s.session.repoUrl) === normalizeRepo(selectedProject.repository)
      )
    : sessions;
  const { agents, loading: agentsLoading } = useAgents(selectedProject?.repository);
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<"list" | "session">("list");
  // hasRestoredRef guards the persist effects from overwriting stored layout data
  // before the deferred restore has had a chance to run (sessions load asynchronously).
  const hasRestoredRef = useRef(false);
  const [openWindows, setOpenWindows] = useState<TiledWindow[]>([]);
  // Ref kept in sync with openWindows state so callbacks can read current value
  // without listing openWindows in their dep arrays (which would invalidate
  // stable references on every window change).
  const openWindowsRef = useRef<TiledWindow[]>([]);
  openWindowsRef.current = openWindows;
  const [minimizedKeys, setMinimizedKeys] = useState<Set<string>>(new Set());
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cadence_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  // Deferred restore: sessions load asynchronously, so we can't restore from
  // sessionStorage in a lazy initializer (sessions would be [] at mount time,
  // causing the persist effect to overwrite stored keys before they're resolved).
  // Instead, restore once sessionsLoaded becomes true.
  useEffect(() => {
    if (hasRestoredRef.current || !sessionsLoaded) return;
    hasRestoredRef.current = true;
    const sessionMap = new Map(sessions.map((s) => [sessionKey(s), s]));
    try {
      const stored = sessionStorage.getItem("cadence_open_windows");
      if (stored) {
        const storedKeys: string[] = JSON.parse(stored);
        const toRestore = storedKeys.flatMap((key) => {
          const s = sessionMap.get(key);
          if (!s) return [];
          return [{ key, session: s.session, agentName: s.agentName, projectId: selectedProject?.id }];
        });
        if (toRestore.length > 0) setOpenWindows(toRestore);
      }
    } catch {
      // ignore storage errors
    }
    try {
      const stored = sessionStorage.getItem("cadence_minimized_windows");
      if (stored) {
        const storedKeys: string[] = JSON.parse(stored);
        const liveKeys = new Set(sessions.map((s) => sessionKey(s)));
        const valid = storedKeys.filter((k) => liveKeys.has(k));
        if (valid.length > 0) setMinimizedKeys(new Set(valid));
      }
    } catch {
      // ignore storage errors
    }
  }, [sessionsLoaded, sessions, selectedProject?.id]);

  // Patch projectId on windows that were restored before selectedProject finished loading.
  // The restore effect sets hasRestoredRef.current = true and blocks re-runs, so windows
  // created during the race window (sessions loaded, projects not yet) have projectId: undefined.
  useEffect(() => {
    if (!selectedProject?.id) return;
    setOpenWindows((prev) => {
      if (!prev.some((w) => !w.projectId)) return prev;
      return prev.map((w) => (w.projectId ? w : { ...w, projectId: selectedProject.id }));
    });
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!hasRestoredRef.current) return;
    try {
      sessionStorage.setItem("cadence_open_windows", JSON.stringify(openWindows.map((w) => w.key)));
    } catch {
      // ignore storage errors
    }
  }, [openWindows]);

  useEffect(() => {
    if (!hasRestoredRef.current) return;
    try {
      sessionStorage.setItem("cadence_minimized_windows", JSON.stringify([...minimizedKeys]));
    } catch {
      // ignore storage errors
    }
  }, [minimizedKeys]);

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
      if (isMobile) setMobileView("session");
      return;
    }

    // If already open, minimize it (toggle off).
    // Read from ref instead of state so openWindows is not needed in the dep
    // array, keeping this callback reference stable across unrelated state changes.
    if (openWindowsRef.current.some((w) => w.key === key)) {
      setMinimizedKeys((prev) => new Set(prev).add(key));
      setOpenWindows((prev) => prev.filter((w) => w.key !== key));
      return;
    }

    // Open new window
    setOpenWindows((prev) => [
      ...prev,
      { key, session: as.session, agentName: as.agentName, projectId: selectedProject?.id },
    ]);
    if (isMobile) setMobileView("session");
  }, [minimizedKeys, selectedProject, isMobile]);

  const handleMinimize = useCallback((key: string) => {
    setMinimizedKeys((prev) => new Set(prev).add(key));
    setOpenWindows((prev) => prev.filter((w) => w.key !== key));
    if (isMobile) setMobileView("list");
  }, [isMobile]);

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

  const { optimisticAddSession } = useSessionsContext();

  const handleLaunched = useCallback((session: Session, agentName: string) => {
    optimisticAddSession(session, agentName);
    const key = `${agentName}:${session.id}`;
    setOpenWindows((prev) => {
      if (prev.some((w) => w.key === key)) return prev;
      return [...prev, { key, session, agentName, projectId: selectedProject?.id }];
    });
    if (isMobile) setMobileView("session");
  }, [optimisticAddSession, selectedProject?.id, isMobile]);

  const loading = agentsLoading;

  const mobileBackButton = isMobile && mobileView === "session" ? (
    <button
      className={styles.mobileBackButton}
      onClick={() => setMobileView("list")}
      aria-label="Back to agent list"
    >
      ← Back
    </button>
  ) : null;

  return (
    <div className={styles.agentManager} data-testid="agent-manager">
      <AgentLaunchForm agents={agents} onLaunched={handleLaunched} repoUrl={selectedProject?.repository} />
      <div className={styles.agentManagerBody}>
        <div className={`${styles.mobilePane} ${isMobile && mobileView === "session" ? styles.mobilePaneHidden : ""}`}>
          <SessionList
            agents={agents}
            sessions={filteredSessions}
            openKeys={openKeys}
            minimizedKeys={minimizedKeys}
            onSessionClick={handleSessionClick}
            isCollapsed={isCollapsed}
            onToggle={toggleSidebar}
          />
        </div>
        <div className={`${styles.tilingContainer} ${isMobile && mobileView === "list" ? styles.mobilePaneHidden : ""}`}>
          {mobileBackButton}
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
