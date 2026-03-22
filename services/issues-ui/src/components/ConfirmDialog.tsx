import { useRef, useEffect, useCallback } from "react";
import styles from "../styles/dialog.module.css";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
    onCancel();
  }, [onCancel]);

  const handleDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        handleClose();
      }
    },
    [handleClose],
  );

  const handleConfirm = useCallback(() => {
    onConfirm();
  }, [onConfirm]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClick={handleDialogClick}
      onCancel={handleClose}
      data-testid="confirm-dialog"
    >
      <div className={styles.dialogContent}>
        <div className={styles.dialogHeader}>
          <h2 className={styles.dialogTitle}>{title}</h2>
          <button
            className={styles.dialogClose}
            onClick={handleClose}
            aria-label="Cancel"
            data-testid="confirm-dialog-cancel-x"
          >
            &times;
          </button>
        </div>
        <p className={styles.dialogMessage}>{message}</p>
        <div className={styles.dialogActions}>
          <button
            className={styles.dialogCancelButton}
            onClick={handleClose}
            data-testid="confirm-dialog-cancel"
          >
            Cancel
          </button>
          <button
            className={styles.dialogConfirmButton}
            onClick={handleConfirm}
            data-testid="confirm-dialog-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
