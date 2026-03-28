import { useState, useCallback, useEffect, useRef } from "react";
import { AgentLauncher } from "./AgentLauncher";
import { Terminal } from "./Terminal";
import { hubFetch } from "../api/agentHubClient";
import { validateSessionId, validateAgentProfile } from "../utils/validateSession";
import { useAgents } from "../hooks/useAgents";
import { useSessionsContext } from "../hooks/SessionsContext";
import { getLaunchConfig } from "./launchConfig";
import type { Session, TicketState } from "../types";
import styles from "../styles/agents.module.css";
import { stripProjectPrefix } from "../utils/sessionName";

interface AgentTabProps {
  ticketNumber: number;
  ticketTitle: string;
  ticketState: TicketState;
  repoUrl: string | undefined;
}

interface ActiveSession {
  session: Session;
  agentName: string;
}

const SESSION_POLL_MS = 3_000;

export function AgentTab({ ticketNumber, ticketTitle, ticketState, repoUrl }: AgentTabProps) {
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [discovering, setDiscovering] = useState(true);
  const [destroying, setDestroying] = useState(false);
  const { agents, loading: agentsLoading } = useAgents();
  const { optimisticSetDestroying, optimisticAddSession } = useSessionsContext();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const launchConfig = getLaunchConfig(ticketState);
  const sessionName = launchConfig.sessionName(ticketNumber);
  const command = launchConfig.command(ticketNumber, ticketTitle);

  // Discover existing sessions for this ticket on mount
  useEffect(() => {
    // Wait for agents to finish loading before discovering sessions
    if (agentsLoading) return;

    let cancelled = false;

    async function discover() {
      const onlineAgents = agents.filter((a) => a.status === "online");
      for (const agent of onlineAgents) {
        try {
          const data = await hubFetch<{ sessions: Session[] }>(
            `/agents/${encodeURIComponent(agent.name)}/sessions`,
          );
          const match = (data.sessions ?? []).find(
            (s) => s.name === sessionName && (s.state === "running" || s.state === "creating"),
          );
          if (match && !cancelled) {
            setActive({ session: match, agentName: agent.name });
            setDiscovering(false);
            return;
          }
        } catch {
          // Agent may be unreachable, continue
        }
      }
      if (!cancelled) setDiscovering(false);
    }

    discover();

    return () => {
      cancelled = true;
    };
  }, [agents, agentsLoading, ticketNumber, sessionName]);

  // Poll for session state transition (creating -> running)
  const activeSessionId = active?.session.id;
  const activeSessionState = active?.session.state;
  const activeAgentName = active?.agentName;

  useEffect(() => {
    if (!activeSessionId || !activeAgentName || activeSessionState !== "creating") {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    pollingRef.current = setInterval(async () => {
      try {
        const data = await hubFetch<{ sessions: Session[] }>(
          `/agents/${encodeURIComponent(activeAgentName)}/sessions`,
        );
        const updated = (data.sessions ?? []).find((s) => s.id === activeSessionId);
        if (updated && updated.state !== activeSessionState) {
          setActive({ session: updated, agentName: activeAgentName });
        }
      } catch {
        // Ignore transient errors
      }
    }, SESSION_POLL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeSessionId, activeSessionState, activeAgentName]);

  const handleLaunched = useCallback((session: Session, agentName: string) => {
    optimisticAddSession(session, agentName);
    setActive({ session, agentName });
  }, [optimisticAddSession]);

  const handleDestroy = useCallback(async () => {
    if (!active) return;
    if (!validateSessionId(active.session.id) || !validateAgentProfile(active.agentName)) {
      console.warn("[AgentTab] Refusing to delete session: invalid id or agentName");
      return;
    }
    optimisticSetDestroying(active.session.id);
    setDestroying(true);
    try {
      await hubFetch(
        `/agents/${encodeURIComponent(active.agentName)}/sessions/${encodeURIComponent(active.session.id)}?force=true`,
        { method: "DELETE" },
      );
      setActive(null);
    } catch {
      // Still clear — if delete failed, the session may already be gone
      setActive(null);
    } finally {
      setDestroying(false);
    }
  }, [active, optimisticSetDestroying]);

  if (discovering) {
    return (
      <div className={styles.agentTabContent} data-testid="agent-tab-content">
        <div className={styles.agentTabEmpty}>
          <p className={styles.agentTabEmptyDesc}>Checking for active sessions…</p>
        </div>
      </div>
    );
  }

  // No active session — show launcher
  if (!active) {
    return (
      <div className={styles.agentTabContent} data-testid="agent-tab-content">
        <div className={styles.agentTabEmpty}>
          <h3 className={styles.agentTabEmptyTitle}>No active agent session</h3>
          <p className={styles.agentTabEmptyDesc}>
            Launch an agent to work on this ticket.
          </p>
        </div>
        <AgentLauncher
          ticketNumber={ticketNumber}
          repoUrl={repoUrl}
          onLaunched={handleLaunched}
          sessionName={sessionName}
          command={command}
          buttonLabel={launchConfig.buttonLabel}
          inline
        />
      </div>
    );
  }

  // Session exists but still creating
  if (active.session.state === "creating") {
    return (
      <div className={styles.agentTabContent} data-testid="agent-tab-content">
        <div className={styles.agentTabEmpty}>
          <h3 className={styles.agentTabEmptyTitle}>Agent session starting…</h3>
          <p className={styles.agentTabEmptyDesc}>
            Waiting for session to be ready.
          </p>
        </div>
      </div>
    );
  }

  // Session is running — show terminal
  return (
    <div className={styles.agentTabTerminal} data-testid="agent-tab-content">
      <div className={styles.terminalHeader} data-testid="terminal-header">
        <span className={styles.terminalSessionName}>
          {stripProjectPrefix(active.session.name)} on {active.agentName}
        </span>
        <button
          className={styles.destroyButton}
          onClick={handleDestroy}
          disabled={destroying}
          data-testid="destroy-session"
        >
          {destroying ? "Destroying…" : "Destroy Session"}
        </button>
      </div>
      <Terminal agentName={active.agentName} sessionId={active.session.id} />
    </div>
  );
}
