import { useState, useCallback } from "react";
import { hubFetch } from "../api/agentHubClient";
import type { Agent, Session } from "../types";
import styles from "../styles/agents.module.css";

interface AgentLaunchFormProps {
  agents: Agent[];
  onLaunched: (session: Session, agentName: string) => void;
}

export function AgentLaunchForm({ agents, onLaunched }: AgentLaunchFormProps) {
  const [selectedHost, setSelectedHost] = useState<string>("");
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onlineAgents = agents.filter((a) => a.status === "online");

  const profileOptions = selectedHost
    ? Object.keys(
        agents.find((a) => a.name === selectedHost)?.profiles ?? {},
      )
    : [];

  const handleHostChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedHost(e.target.value);
      setSelectedProfile("");
    },
    [],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!selectedHost || !selectedProfile || !name.trim()) {
        setError("Host, profile, and name are all required.");
        return;
      }

      setLaunching(true);
      setError(null);

      try {
        const session = await hubFetch<Session>(
          `/agents/${encodeURIComponent(selectedHost)}/sessions`,
          {
            method: "POST",
            body: JSON.stringify({
              agent_profile: selectedProfile,
              session_name: name.trim(),
            }),
          },
        );
        onLaunched(session, selectedHost);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to launch session",
        );
      } finally {
        setLaunching(false);
      }
    },
    [selectedHost, selectedProfile, name, onLaunched],
  );

  return (
    <form
      className={styles.launchForm}
      onSubmit={handleSubmit}
      data-testid="agent-launch-form"
    >
      <div className={styles.launchFormFields}>
        <div className={styles.profileSelect}>
          <label className={styles.profileLabel} htmlFor="launch-host-select">
            Host
          </label>
          <select
            id="launch-host-select"
            className={styles.select}
            value={selectedHost}
            onChange={handleHostChange}
            data-testid="host-select"
          >
            <option value="">— select host —</option>
            {onlineAgents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.profileSelect}>
          <label
            className={styles.profileLabel}
            htmlFor="launch-profile-select"
          >
            Profile
          </label>
          <select
            id="launch-profile-select"
            className={styles.select}
            value={selectedProfile}
            onChange={(e) => setSelectedProfile(e.target.value)}
            disabled={!selectedHost}
            data-testid="profile-select"
          >
            <option value="">— select profile —</option>
            {profileOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.profileSelect}>
          <label className={styles.profileLabel} htmlFor="launch-name-input">
            Name
          </label>
          <input
            id="launch-name-input"
            type="text"
            className={styles.nameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Session name"
            data-testid="name-input"
          />
        </div>
      </div>

      {error && <div className={styles.launcherError}>{error}</div>}

      <button
        type="submit"
        className={styles.launchButton}
        disabled={launching}
        data-testid="launch-submit"
      >
        {launching ? "Launching…" : "Launch Session"}
      </button>
    </form>
  );
}
