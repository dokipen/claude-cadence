import { useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { AgentLauncher } from "./AgentLauncher";
import type { Session } from "../types";
import styles from "../styles/dialog.module.css";

interface LaunchAgentDialogProps {
  ticketId: string;
  ticketNumber: number;
  repoUrl: string | undefined;
  open: boolean;
  onClose: () => void;
}

export function LaunchAgentDialog({
  ticketId,
  ticketNumber,
  repoUrl,
  open,
  onClose,
}: LaunchAgentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();

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

  const handleLaunched = useCallback(
    (_session: Session) => {
      handleClose();
      navigate(`/ticket/${ticketId}?tab=agent`);
    },
    [ticketId, handleClose, navigate],
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
      data-testid="launch-agent-dialog"
    >
      <div className={styles.dialogContent}>
        <div className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>Launch Agent on #{ticketNumber}</h2>
          <button
            className={styles.dialogClose}
            onClick={handleClose}
            aria-label="Close"
            data-testid="dialog-close"
          >
            &times;
          </button>
        </div>
        <AgentLauncher
          ticketNumber={ticketNumber}
          repoUrl={repoUrl}
          onLaunched={handleLaunched}
        />
      </div>
    </dialog>
  );
}
