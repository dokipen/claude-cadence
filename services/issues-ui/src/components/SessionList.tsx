import type { Agent } from "../types";
import type { AgentSession } from "../hooks/useSessions";
import styles from "../styles/agents.module.css";

interface SessionListProps {
  agents: Agent[];
  sessions: AgentSession[];
  openKeys: Set<string>;
  onSessionClick: (session: AgentSession) => void;
}

function sessionKey(s: AgentSession): string {
  return `${s.agentName}:${s.session.id}`;
}

export function SessionList({ agents, sessions, openKeys, onSessionClick }: SessionListProps) {
  // Group sessions by agent
  const sessionsByAgent = new Map<string, AgentSession[]>();
  for (const s of sessions) {
    const list = sessionsByAgent.get(s.agentName) || [];
    list.push(s);
    sessionsByAgent.set(s.agentName, list);
  }

  return (
    <div className={styles.sessionSidebar} data-testid="session-list">
      <h3 className={styles.sidebarTitle}>Agents</h3>
      {agents.length === 0 && (
        <p className={styles.sidebarEmpty}>No agents registered.</p>
      )}
      {agents.map((agent) => {
        const agentSessions = sessionsByAgent.get(agent.name) || [];
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
  );
}

export { sessionKey };
