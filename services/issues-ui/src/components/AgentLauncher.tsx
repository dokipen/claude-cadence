import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { createSession } from "../api/agentHubClient";
import { useAgents, useAgentProfiles } from "../hooks/useAgents";
import type { Session } from "../types";
import styles from "../styles/agents.module.css";

interface AgentLauncherProps {
  ticketNumber: number;
  repoUrl: string | undefined;
  onLaunched: (session: Session, agentName: string) => void;
  inline?: boolean;
  command?: string;
  sessionName?: string;
  buttonLabel?: string;
}

export interface AgentLauncherHandle {
  launch: () => void;
}

export const AgentLauncher = forwardRef<AgentLauncherHandle, AgentLauncherProps>(function AgentLauncher({
  ticketNumber,
  repoUrl,
  onLaunched,
  inline,
  command = `/lead ${ticketNumber}`,
  sessionName = `lead-${ticketNumber}`,
  buttonLabel = "Lead",
}: AgentLauncherProps, ref) {
  const { agents, loading: agentsLoading, error: agentsError } = useAgents(repoUrl);
  const profiles = useAgentProfiles(repoUrl, agents);
  const singleMatch = profiles.length === 1;

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Reset selection when profiles change (agents go online/offline)
  useEffect(() => {
    setSelectedIndex(0);
  }, [profiles]);

  const selected = profiles[selectedIndex] ?? profiles[0];

  const handleLaunch = useCallback(async () => {
    if (launchingRef.current) return;
    launchingRef.current = true;
    if (!selected) return;
    setLaunching(true);
    setError(null);

    const cappedCommand =
      command.length > 500 ? command.slice(0, 500) + "…" : command;

    try {
      const session = await createSession(selected.agent, selected.profileName, sessionName, [cappedCommand]);
      onLaunched(session, selected.agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch agent");
    } finally {
      setLaunching(false);
      launchingRef.current = false;
    }
  }, [selected, command, sessionName, onLaunched]);

  useImperativeHandle(ref, () => ({ launch: handleLaunch }), [handleLaunch]);

  if (agentsLoading) {
    return <div className={styles.launcherMessage}>Loading agents…</div>;
  }

  if (agentsError) {
    return <div className={styles.launcherError}>{agentsError}</div>;
  }

  if (!repoUrl) {
    return (
      <div className={styles.launcherMessage}>
        No repository configured for this project.
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className={styles.launcherMessage}>
        No online agents with profiles matching this repository.
      </div>
    );
  }

  return (
    <div
      className={inline ? styles.launcherInline : styles.launcher}
      data-testid="agent-launcher"
    >
      {singleMatch ? (
        <div className={styles.profileSingle} data-testid="profile-single">
          <span className={styles.profileLabel}>Agent</span>
          <span className={styles.profileValue}>
            {selected.agent} / {selected.profileName}
          </span>
        </div>
      ) : (
        <div className={styles.profileSelect}>
          <label className={styles.profileLabel} htmlFor="agent-profile-select">
            Agent / Profile
          </label>
          <select
            id="agent-profile-select"
            className={styles.select}
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            autoComplete="off"
            data-testid="profile-select"
          >
            {profiles.map((entry, i) => (
              <option key={`${entry.agent}-${entry.profileName}`} value={i}>
                {entry.agent} / {entry.profileName}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <div className={styles.launcherError}>{error}</div>}

      <button
        className={styles.launchButton}
        onClick={handleLaunch}
        disabled={launching || !selected}
        data-testid="launch-submit"
      >
        {launching ? "Launching…" : buttonLabel}
      </button>
    </div>
  );
});
