import { useState, useCallback, useEffect } from "react";
import { createSession } from "../api/agentHubClient";
import { normalizeRepo } from "../hooks/useAgents";
import { normalizeSessionName } from "../utils/sessionName";
import type { Agent, Session } from "../types";
import styles from "../styles/agents.module.css";

interface AgentLaunchFormProps {
  agents: Agent[];
  onLaunched: (session: Session, agentName: string) => void;
  repoUrl?: string;
}

export function AgentLaunchForm({ agents, onLaunched, repoUrl }: AgentLaunchFormProps) {
  const [selectedHost, setSelectedHost] = useState<string>("");
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedHost("");
    setSelectedProfile("");
  }, [repoUrl]);

  const onlineAgents = agents.filter((a) => a.status === "online");

  const selectedAgent = selectedHost ? onlineAgents.find((a) => a.name === selectedHost) : undefined;
  const profileOptions = selectedAgent
    ? Object.entries(selectedAgent.profiles)
        .filter(([, profile]) =>
          !repoUrl || !profile.repo || normalizeRepo(profile.repo) === normalizeRepo(repoUrl)
        )
        .map(([key, profile]) => ({ key, label: profile.name || key }))
        .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
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

      if (!selectedHost || !selectedProfile) {
        setError("Host and profile are required.");
        return;
      }

      const normalized = normalizeSessionName(name);
      if (!normalized) {
        setError("Session name cannot be empty.");
        return;
      }

      setLaunching(true);
      setError(null);

      try {
        const session = await createSession(selectedHost, selectedProfile, normalized);
        onLaunched(session, selectedHost);
        setSelectedHost("");
        setSelectedProfile("");
        setName("");
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
            autoComplete="off"
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
            autoComplete="off"
            data-testid="profile-select"
          >
            <option value="">— select profile —</option>
            {profileOptions.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
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
            maxLength={100}
            autoComplete="off"
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
