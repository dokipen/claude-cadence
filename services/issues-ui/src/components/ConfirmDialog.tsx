import { useRef, useEffect, useCallback } from "react";
import styles from "../styles/dialog.module.css";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  anchorRect?: DOMRect;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  anchorRect,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      el.showModal();
      if (anchorRect) {
        // Double-rAF ensures a layout pass has occurred so offsetWidth/offsetHeight are valid
        requestAnimationFrame(() => requestAnimationFrame(() => {
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
        }));
      }
    } else if (!open && el.open) {
      el.close();
      el.style.position = '';
      el.style.margin = '';
      el.style.top = '';
      el.style.left = '';
    }

    return () => {
      if (el.open) el.close();
    };
  }, [open, anchorRect]);

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
      {open && (
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
      )}
    </dialog>
  );
}
