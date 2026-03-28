import type { Agent } from "../types";
import type { AgentSession } from "../hooks/useAllSessions";
import styles from "../styles/agents.module.css";

interface SessionListProps {
  agents: Agent[];
  sessions: AgentSession[];
  openKeys: Set<string>;
  minimizedKeys: Set<string>;
  onSessionClick: (session: AgentSession) => void;
  isCollapsed: boolean;
  onToggle: () => void;
}

function sessionKey(s: AgentSession): string {
  return `${s.agentName}:${s.session.id}`;
}

// Set to true to show session state and source for debugging
const DEBUG_SESSION_STATE = false;

export function SessionList({ agents, sessions, openKeys, minimizedKeys, onSessionClick, isCollapsed, onToggle }: SessionListProps) {
  // Group sessions by agent
  const sessionsByAgent = new Map<string, AgentSession[]>();
  for (const s of sessions) {
    const list = sessionsByAgent.get(s.agentName) || [];
    list.push(s);
    sessionsByAgent.set(s.agentName, list);
  }

  return (
    <div className={styles.sidebarWrapper} data-testid="session-list">
      <div className={`${styles.sessionSidebar}${isCollapsed ? ` ${styles.collapsed}` : ""}`}>
        <div
          inert={isCollapsed || undefined}
          aria-hidden={isCollapsed}
          className={`${styles.sidebarContent}${isCollapsed ? ` ${styles.sidebarContentHidden}` : ""}`}
        >
          <h3 className={styles.sidebarTitle}>Agents</h3>
          {agents.length === 0 && (
            <p className={styles.sidebarEmpty}>No agents registered.</p>
          )}
          {[...agents].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map((agent) => {
            const agentSessions = (sessionsByAgent.get(agent.name) || []).slice().sort((a, b) => a.session.createdAt.localeCompare(b.session.createdAt));
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
                  const isMinimized = minimizedKeys.has(key);
                  const isRunning = as.session.state === "running";
                  const isDestroying = as.session.state === "destroying";
                  const isCreating = as.session.state === "creating";
                  return (
                    <button
                      key={as.session.id}
                      className={`${styles.sidebarSession} ${isOpen ? styles.sidebarSessionOpen : ""} ${!isRunning && !isDestroying && !isCreating ? styles.sidebarSessionStopped : ""} ${isDestroying && !as.session.waitingForInput ? styles.sidebarSessionDestroying : ""} ${isCreating && !as.session.waitingForInput ? styles.sidebarSessionCreating : ""} ${as.session.waitingForInput ? styles.sidebarSessionWaiting : ""} ${isMinimized ? styles.sidebarSessionMinimized : ""}`}
                      onClick={() => !isDestroying && onSessionClick(as)}
                      disabled={isDestroying}
                      data-testid="sidebar-session"
                      title={`${as.session.name} (${as.session.state})`}
                    >
                      <span className={styles.sessionDot}>
                        {as.session.waitingForInput ? "◉" : isMinimized ? "▼" : isCreating ? "◌" : isRunning || isDestroying ? "●" : "○"}
                      </span>
                      <span className={styles.sessionName}>
                        {as.session.name}
                        {DEBUG_SESSION_STATE && ` [${as.session.state}][${as.stateSource ?? "?"}]`}
                      </span>
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
