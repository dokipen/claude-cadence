import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { createSession } from "../api/agentHubClient";
import { useAgents, useAgentProfiles } from "../hooks/useAgents";
import type { Session } from "../types";
import styles from "../styles/agents.module.css";

export const MAX_SESSION_COMMAND_LENGTH = 500;

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

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Reset selection only when the selected profile is no longer available (agent went offline).
  // Using the updater form avoids adding selectedKey to the dependency array, which would
  // cause the effect to re-run on every user selection change and could reset the key.
  useEffect(() => {
    if (profiles.length === 0) return;
    setSelectedKey((prev) => {
      const stillPresent = prev !== null && profiles.some((e) => `${e.agent}/${e.profileName}` === prev);
      return stillPresent ? prev : `${profiles[0].agent}/${profiles[0].profileName}`;
    });
  }, [profiles]);

  const selected = profiles.find((e) => `${e.agent}/${e.profileName}` === selectedKey) ?? profiles[0];

  const handleLaunch = useCallback(async () => {
    if (!selected) return;
    if (launchingRef.current) return;
    launchingRef.current = true;
    setLaunching(true);
    setError(null);

    const cappedCommand =
      command.length > MAX_SESSION_COMMAND_LENGTH
        ? command.slice(0, MAX_SESSION_COMMAND_LENGTH) + "…"
        : command;

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
            {selected.agent} / {selected.profile.name || selected.profileName}
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
            value={selectedKey ?? ""}
            onChange={(e) => setSelectedKey(e.target.value)}
            autoComplete="off"
            data-testid="profile-select"
          >
            {profiles.map((entry) => {
              const key = `${entry.agent}/${entry.profileName}`;
              return (
                <option key={key} value={key}>
                  {entry.agent} / {entry.profile.name || entry.profileName}
                </option>
              );
            })}
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
