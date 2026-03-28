import { useRef, useEffect, useCallback } from "react";
import { AgentLauncher } from "./AgentLauncher";
import { getLaunchConfig } from "./launchConfig";
import type { Session, TicketState } from "../types";
import styles from "../styles/dialog.module.css";

interface LaunchAgentDialogProps {
  ticketNumber: number;
  repoUrl: string | undefined;
  open: boolean;
  onClose: () => void;
  ticketState: TicketState;
  ticketTitle: string;
  anchorRect?: DOMRect;
  projectId?: string;
}

export function LaunchAgentDialog({
  ticketNumber,
  repoUrl,
  open,
  onClose,
  ticketState,
  ticketTitle,
  anchorRect,
  projectId,
}: LaunchAgentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const config = getLaunchConfig(ticketState);
  const command = config.command(ticketNumber, ticketTitle);
  const sessionName = config.sessionName(ticketNumber, projectId);
  const buttonLabel = config.buttonLabel;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      el.showModal();
      if (anchorRect) {
        requestAnimationFrame(() => {
          el.style.position = 'fixed';
          el.style.margin = '0';
          const gap = 8;
          let top = anchorRect.bottom + gap;
          let left = anchorRect.left;
          const dialogWidth = el.offsetWidth;
          const dialogHeight = el.offsetHeight;
          if (left + dialogWidth > window.innerWidth - gap) {
            left = window.innerWidth - dialogWidth - gap;
          }
          if (left < gap) left = gap;
          if (top + dialogHeight > window.innerHeight - gap) {
            top = anchorRect.top - dialogHeight - gap;
          }
          if (top < gap) top = gap;
          el.style.top = `${top}px`;
          el.style.left = `${left}px`;
        });
      }
    } else if (!open && el.open) {
      el.style.position = '';
      el.style.margin = '';
      el.style.top = '';
      el.style.left = '';
      el.close();
    }

    return () => {
      if (el.open) el.close();
    };
  }, [open, anchorRect]);

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
        {open && (
          <AgentLauncher
            ticketNumber={ticketNumber}
            repoUrl={repoUrl}
            onLaunched={handleLaunched}
            command={command}
            sessionName={sessionName}
            buttonLabel={buttonLabel}
          />
        )}
      </div>
    </dialog>
  );
}
