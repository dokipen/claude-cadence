import { useRef, useEffect, useCallback, useState } from "react";
import { AgentLauncher } from "./AgentLauncher";
import type { Session } from "../types";
import styles from "../styles/dialog.module.css";

interface CreateTicketDialogProps {
  open: boolean;
  onClose: () => void;
  repoUrl?: string;
  projectId?: string;
}

export function CreateTicketDialog({
  open,
  onClose,
  repoUrl,
  projectId,
}: CreateTicketDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [prompt, setPrompt] = useState("");
  // Generated once per open — stable for the lifetime of a single dialog session.
  const sessionNameRef = useRef(`${projectId ? projectId + "-" : ""}ticket-` + Date.now());

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      sessionNameRef.current = `${projectId ? projectId + "-" : ""}ticket-` + Date.now();
      el.showModal();
    } else if (!open && el.open) {
      setPrompt("");
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

  const handleLaunched = useCallback(
    (_session: Session, _agentName: string) => {
      handleClose();
    },
    [handleClose],
  );

  // Close on backdrop click
  const handleDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        handleClose();
      }
    },
    [handleClose],
  );

  const trimmedPrompt = prompt.trim();
  // Normalize whitespace before passing to the command to avoid newlines
  // or other control characters reaching the PTY.
  const normalizedPrompt = trimmedPrompt.replace(/\s+/g, " ");

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClick={handleDialogClick}
      onCancel={handleClose}
      data-testid="create-ticket-dialog"
    >
      <div className={styles.dialogContent}>
        <div className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>Create Ticket</h2>
          <button
            className={styles.dialogClose}
            onClick={handleClose}
            aria-label="Close"
            data-testid="dialog-close"
          >
            &times;
          </button>
        </div>
        <div>
          <label htmlFor="ticket-prompt-input" className={styles.dialogMessage}>
            What should this ticket be about?
          </label>
          <textarea
            id="ticket-prompt-input"
            data-testid="ticket-prompt"
            rows={4}
            className={styles.promptTextarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoComplete="off"
          />
        </div>
        {open && trimmedPrompt !== "" && (
          <AgentLauncher
            ticketNumber={0}
            repoUrl={repoUrl}
            onLaunched={handleLaunched}
            command={"/create-ticket " + normalizedPrompt}
            sessionName={sessionNameRef.current}
            buttonLabel="Create Ticket"
          />
        )}
        <div className={styles.dialogActions}>
          <button
            className={styles.dialogCancelButton}
            onClick={handleClose}
            data-testid="dialog-cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
