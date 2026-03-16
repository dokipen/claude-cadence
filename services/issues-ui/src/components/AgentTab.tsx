import { useState, useCallback, useEffect, useRef } from "react";
import { AgentLauncher } from "./AgentLauncher";
import { Terminal } from "./Terminal";
import { hubFetch } from "../api/agentHubClient";
import { useAgents } from "../hooks/useAgents";
import type { Session } from "../types";
import styles from "../styles/agents.module.css";

interface AgentTabProps {
  ticketNumber: number;
  repoUrl: string | undefined;
}

interface ActiveSession {
  session: Session;
  agentName: string;
}

const SESSION_POLL_MS = 3_000;

export function AgentTab({ ticketNumber, repoUrl }: AgentTabProps) {
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [discovering, setDiscovering] = useState(true);
  const [destroying, setDestroying] = useState(false);
  const { agents } = useAgents();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Discover existing sessions for this ticket on mount
  useEffect(() => {
    let cancelled = false;
    const sessionName = `lead-${ticketNumber}`;

    async function discover() {
      const onlineAgents = agents.filter((a) => a.status === "online");
      for (const agent of onlineAgents) {
        try {
          const sessions = await hubFetch<Session[]>(
            `/agents/${encodeURIComponent(agent.name)}/sessions`,
          );
          const match = sessions.find(
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

    if (agents.length > 0) {
      discover();
    } else {
      setDiscovering(false);
    }

    return () => {
      cancelled = true;
    };
  }, [agents, ticketNumber]);

  // Poll for session state transition (creating -> running)
  useEffect(() => {
    if (!active || active.session.state !== "creating") {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    pollingRef.current = setInterval(async () => {
      try {
        const sessions = await hubFetch<Session[]>(
          `/agents/${encodeURIComponent(active.agentName)}/sessions`,
        );
        const updated = sessions.find((s) => s.id === active.session.id);
        if (updated && updated.state !== active.session.state) {
          setActive({ session: updated, agentName: active.agentName });
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
  }, [active]);

  const handleLaunched = useCallback((session: Session, agentName: string) => {
    setActive({ session, agentName });
  }, []);

  const handleDestroy = useCallback(async () => {
    if (!active) return;
    setDestroying(true);
    try {
      await hubFetch(
        `/agents/${encodeURIComponent(active.agentName)}/sessions/${encodeURIComponent(active.session.id)}`,
        { method: "DELETE" },
      );
      setActive(null);
    } catch {
      // Still clear — if delete failed, the session may already be gone
      setActive(null);
    } finally {
      setDestroying(false);
    }
  }, [active]);

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
          {active.session.name} on {active.agentName}
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
