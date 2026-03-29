import { useRef, useEffect, useCallback, useState } from "react";
import { createSession } from "../api/agentHubClient";
import { useAgents, useAgentProfiles } from "../hooks/useAgents";
import type { Ticket } from "../types";
import styles from "../styles/dialog.module.css";
import agentStyles from "../styles/agents.module.css";

interface LeadAllDialogProps {
  repoUrl: string | undefined;
  open: boolean;
  onClose: () => void;
  projectId?: string;
  tickets: Ticket[];
}

export function LeadAllDialog({
  repoUrl,
  open,
  onClose,
  projectId,
  tickets,
}: LeadAllDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { agents, loading: agentsLoading, error: agentsError } = useAgents(repoUrl);
  const profiles = useAgentProfiles(repoUrl, agents);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedKeys(new Set());
      setLaunchError(null);
    }
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }

    return () => {
      if (el.open) el.close();
    };
  }, [open]);

  const handleClose = useCallback(() => {
    dialogRef.current?.close();
    onClose();
  }, [onClose]);

  const handleDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        handleClose();
      }
    },
    [handleClose],
  );

  const handleToggle = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    const selectedProfiles = profiles.filter((p) =>
      selectedKeys.has(`${p.agent}/${p.profileName}`)
    );
    if (selectedProfiles.length === 0 || tickets.length === 0) return;

    setLaunching(true);
    setLaunchError(null);

    try {
      await Promise.all(
        tickets.map((ticket) => {
          const assigned =
            selectedProfiles[Math.floor(Math.random() * selectedProfiles.length)];
          const sessionName = `${projectId ? projectId + "-" : ""}lead-all-${ticket.number}`;
          const command = `/lead ${ticket.number}`;
          const cappedCommand =
            command.length > 500 ? command.slice(0, 500) + "…" : command;
          return createSession(assigned.agent, assigned.profileName, sessionName, [
            cappedCommand,
          ]);
        })
      );
      handleClose();
    } catch (err) {
      setLaunchError(
        err instanceof Error ? err.message : "Failed to launch agents"
      );
    } finally {
      setLaunching(false);
    }
  }, [profiles, selectedKeys, tickets, projectId, handleClose]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClick={handleDialogClick}
      onCancel={handleClose}
      data-testid="lead-all-dialog"
    >
      <div className={styles.dialogContent}>
        <div className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>Lead All Refined Tickets</h2>
          <button
            className={styles.dialogClose}
            onClick={handleClose}
            aria-label="Close"
            data-testid="dialog-close"
          >
            &times;
          </button>
        </div>
        {open && (
          <>
            {agentsLoading && (
              <p className={styles.dialogMessage}>Loading agents…</p>
            )}
            {agentsError && (
              <p className={styles.dialogMessage}>{agentsError}</p>
            )}
            {!agentsLoading && !agentsError && !repoUrl && (
              <p className={styles.dialogMessage}>
                No repository configured for this project.
              </p>
            )}
            {!agentsLoading && !agentsError && repoUrl && profiles.length === 0 && (
              <p className={styles.dialogMessage}>
                No online agents with profiles matching this repository.
              </p>
            )}
            {!agentsLoading && !agentsError && profiles.length > 0 && (
              <div data-testid="profile-list">
                {profiles.map((entry) => {
                  const key = `${entry.agent}/${entry.profileName}`;
                  return (
                    <label
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                        padding: "0.25rem 0",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(key)}
                        onChange={() => handleToggle(key)}
                        data-testid={`profile-checkbox-${key}`}
                      />
                      {entry.agent} / {entry.profileName}
                    </label>
                  );
                })}
              </div>
            )}
            {launchError && (
              <p className={styles.dialogMessage} data-testid="launch-error">
                {launchError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button
                className={styles.dialogCancelButton}
                onClick={handleClose}
                data-testid="cancel-button"
              >
                Cancel
              </button>
              <button
                className={agentStyles.launchButton}
                onClick={handleConfirm}
                disabled={
                  launching || selectedKeys.size === 0 || tickets.length === 0
                }
                data-testid="confirm-button"
              >
                {launching ? "Launching…" : `Lead All (${tickets.length})`}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
