import { useRef, useEffect, useCallback, useState } from "react";
import { AgentLauncher, MAX_SESSION_COMMAND_LENGTH } from "./AgentLauncher";
import type { AgentLauncherHandle } from "./AgentLauncher";
import type { Session } from "../types";
import styles from "../styles/dialog.module.css";

interface CreateTicketDialogProps {
  open: boolean;
  onClose: () => void;
  repoUrl?: string;
  projectId?: string;
}

const CREATE_TICKET_COMMAND_PREFIX = "/create-ticket ";
const CREATE_TICKET_PROMPT_MAX_LENGTH =
  MAX_SESSION_COMMAND_LENGTH - CREATE_TICKET_COMMAND_PREFIX.length;

export function CreateTicketDialog({
  open,
  onClose,
  repoUrl,
  projectId,
}: CreateTicketDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const launcherRef = useRef<AgentLauncherHandle>(null);
  const [prompt, setPrompt] = useState("");
  // Constrain projectId to [a-z0-9-] to prevent unexpected characters in the session name.
  const safeProjectId = projectId?.replace(/[^a-z0-9-]/g, "") ?? "";
  // Generated once per open — stable for the lifetime of a single dialog session.
  const sessionNameRef = useRef(`${safeProjectId ? safeProjectId + "-" : ""}ticket-` + Date.now());

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      sessionNameRef.current = `${safeProjectId ? safeProjectId + "-" : ""}ticket-` + Date.now();
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }

    return () => {
      if (el.open) el.close();
    };
  }, [open, safeProjectId]);

  const handleClose = useCallback(
    (clear: any = false) => {
      if (clear === true) setPrompt("");
      onClose();
    },
    [onClose],
  );

  const handleLaunched = useCallback(
    (_session: Session, _agentName: string) => {
      handleClose(true);
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

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        launcherRef.current?.launch();
      }
    },
    [],
  );

  const trimmedPrompt = prompt.trim();
  // Normalize whitespace first (converts \t, \n, \r to spaces), then strip
  // remaining C0 controls, DEL, and C1 controls (U+0080-U+009F, which include
  // the 8-bit CSI introducer) before passing to the PTY command.
  const normalizedPrompt = trimmedPrompt
    .replace(/\s+/g, " ")
    .replace(/[\x00-\x1f\x7f\u0080-\u009f]/g, "");

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
            maxLength={CREATE_TICKET_PROMPT_MAX_LENGTH}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            autoComplete="off"
          />
        </div>
        {open && normalizedPrompt !== "" && (
          <AgentLauncher
            ref={launcherRef}
            ticketNumber={0}
            repoUrl={repoUrl}
            onLaunched={handleLaunched}
            command={CREATE_TICKET_COMMAND_PREFIX + normalizedPrompt}
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
