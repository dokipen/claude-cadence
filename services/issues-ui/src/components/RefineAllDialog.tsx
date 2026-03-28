import { useRef, useEffect, useCallback } from "react";
import { AgentLauncher } from "./AgentLauncher";
import type { Session } from "../types";
import styles from "../styles/dialog.module.css";

interface RefineAllDialogProps {
  repoUrl: string | undefined;
  open: boolean;
  onClose: () => void;
}

export function RefineAllDialog({
  repoUrl,
  open,
  onClose,
}: RefineAllDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const command = "/refine";
  // Generated once on mount; refreshed in the useEffect on each open so rapid
  // re-opens also get a fresh name.
  const sessionNameRef = useRef("refine-all-" + Date.now());
  const buttonLabel = "Refine All";

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      sessionNameRef.current = "refine-all-" + Date.now();
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

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClick={handleDialogClick}
      onCancel={handleClose}
      data-testid="refine-all-dialog"
    >
      <div className={styles.dialogContent}>
        <div className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>Refine All Backlog Tickets</h2>
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
          <AgentLauncher
            ticketNumber={0}
            repoUrl={repoUrl}
            onLaunched={handleLaunched}
            command={command}
            sessionName={sessionNameRef.current}
            buttonLabel={buttonLabel}
          />
        )}
      </div>
    </dialog>
  );
}
