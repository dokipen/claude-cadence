import { useRef, useEffect } from "react";
import type { Agent } from "../types";
import type { AgentSession } from "../hooks/useAllSessions";
import styles from "../styles/agents.module.css";

interface SessionListProps {
  agents: Agent[];
  sessions: AgentSession[];
  openKeys: Set<string>;
  onSessionClick: (session: AgentSession) => void;
  isCollapsed: boolean;
  onToggle: () => void;
}

function sessionKey(s: AgentSession): string {
  return `${s.agentName}:${s.session.id}`;
}

export function SessionList({ agents, sessions, openKeys, onSessionClick, isCollapsed, onToggle }: SessionListProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    const sidebar = sidebarRef.current;
    if (!content) return;

    if (isCollapsed) {
      content.setAttribute("inert", "");
      return;
    }

    if (!sidebar) {
      content.removeAttribute("inert");
      return;
    }

    const handleTransitionEnd = (e: TransitionEvent) => {
      if (e.target === sidebar && e.propertyName === "width") {
        content.removeAttribute("inert");
      }
    };
    sidebar.addEventListener("transitionend", handleTransitionEnd, { once: true });
    return () => sidebar.removeEventListener("transitionend", handleTransitionEnd);
  }, [isCollapsed]);

  // Group sessions by agent
  const sessionsByAgent = new Map<string, AgentSession[]>();
  for (const s of sessions) {
    const list = sessionsByAgent.get(s.agentName) || [];
    list.push(s);
    sessionsByAgent.set(s.agentName, list);
  }

  return (
    <div className={styles.sidebarWrapper} data-testid="session-list">
      <div ref={sidebarRef} className={`${styles.sessionSidebar}${isCollapsed ? ` ${styles.collapsed}` : ""}`}>
        <div
          ref={contentRef}
          aria-hidden={isCollapsed}
          className={`${styles.sidebarContent}${isCollapsed ? ` ${styles.sidebarContentHidden}` : ""}`}
        >
          <h3 className={styles.sidebarTitle}>Agents</h3>
          {agents.length === 0 && (
            <p className={styles.sidebarEmpty}>No agents registered.</p>
          )}
          {[...agents].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map((agent) => {
            const agentSessions = (sessionsByAgent.get(agent.name) || []).slice().sort((a, b) => a.session.created_at.localeCompare(b.session.created_at));
            return (
              <div key={agent.name} className={styles.sidebarAgent} data-testid="sidebar-agent">
                <div className={styles.sidebarAgentHeader}>
                  <span
                    className={
                      agent.status === "online"
                        ? styles.statusDotOnline
                        : styles.statusDotOffline
                    }
                    data-testid={`status-${agent.status}`}
                  />
                  <span className={styles.sidebarAgentName}>{agent.name}</span>
                </div>
                {agentSessions.length === 0 && (
                  <p className={styles.sidebarNoSessions}>No sessions</p>
                )}
                {agentSessions.map((as) => {
                  const key = sessionKey(as);
                  const isOpen = openKeys.has(key);
                  const isRunning = as.session.state === "running";
                  return (
                    <button
                      key={as.session.id}
                      className={`${styles.sidebarSession} ${isOpen ? styles.sidebarSessionOpen : ""} ${!isRunning ? styles.sidebarSessionStopped : ""} ${as.session.waiting_for_input ? styles.sidebarSessionWaiting : ""}`}
                      onClick={() => onSessionClick(as)}
                      data-testid="sidebar-session"
                      title={`${as.session.name} (${as.session.state})`}
                    >
                      <span className={styles.sessionDot}>
                        {as.session.waiting_for_input ? "◉" : isRunning ? "●" : "○"}
                      </span>
                      <span className={styles.sessionName}>{as.session.name}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <button
        className={styles.sidebarToggle}
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        data-testid="sidebar-toggle"
      >
        {isCollapsed ? "▶" : "◀"}
      </button>
    </div>
  );
}

export { sessionKey };
