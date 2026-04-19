import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "./Terminal";
import type { TerminalHandle } from "./Terminal";
import type { TiledWindow } from "./TilingLayout";
import styles from "../styles/agents.module.css";

interface MobileSessionViewProps {
  win: TiledWindow;
  onBack: () => void;
  onClose: () => void;
}

interface MobileInputDialogProps {
  open: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

function MobileInputDialog({ open, onSubmit, onClose }: MobileInputDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      textareaRef.current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
    return () => {
      if (el.open) el.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  const handleSubmit = useCallback(() => {
    onSubmit(text);
    setText("");
  }, [text, onSubmit]);

  const handleCancel = useCallback(() => {
    setText("");
    onClose();
  }, [onClose]);

  const handleDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        handleCancel();
      }
    },
    [handleCancel],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <dialog
      ref={dialogRef}
      className={styles.mobileInputDialog}
      onClick={handleDialogClick}
      onCancel={handleCancel}
      data-testid="mobile-input-dialog"
    >
      {open && (
        <div className={styles.mobileInputDialogContent}>
          <textarea
            ref={textareaRef}
            className={styles.mobileInputTextarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={3}
            data-testid="mobile-input-textarea"
          />
          <div className={styles.mobileInputDialogActions}>
            <button
              className={styles.mobileInputCancelButton}
              onClick={handleCancel}
              data-testid="mobile-input-cancel"
            >
              Cancel
            </button>
            <button
              className={styles.mobileInputSubmitButton}
              onClick={handleSubmit}
              data-testid="mobile-input-submit"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

export function MobileSessionView({ win, onBack, onClose }: MobileSessionViewProps) {
  const terminalRef = useRef<TerminalHandle>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number>(
    () => window.visualViewport?.height ?? window.innerHeight,
  );
  const [viewportWidth, setViewportWidth] = useState<number>(
    () => window.visualViewport?.width ?? window.innerWidth,
  );
  const [viewportOffsetLeft, setViewportOffsetLeft] = useState<number>(
    () => window.visualViewport?.offsetLeft ?? 0,
  );

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => {
      setViewportHeight(vv.height);
      setViewportWidth(vv.width);
      setViewportOffsetLeft(vv.offsetLeft);
    };
    vv.addEventListener("resize", handleResize);
    // iOS Safari fires "scroll" on visualViewport (not "resize") when the
    // on-screen keyboard appears or disappears or the page is panned.
    vv.addEventListener("scroll", handleResize);
    // Sync once immediately in case the viewport changed between initial render
    // and this effect running.
    handleResize();
    return () => {
      vv.removeEventListener("resize", handleResize);
      vv.removeEventListener("scroll", handleResize);
    };
  }, []);

  const handleDialogSubmit = useCallback((text: string) => {
    terminalRef.current?.sendInput(text + "\r");
    setDialogOpen(false);
  }, []);

  const handleDialogClose = useCallback(() => setDialogOpen(false), []);

  return (
    <div
      className={styles.mobileSessionView}
      style={{ height: viewportHeight, width: viewportWidth, left: viewportOffsetLeft }}
      data-testid="mobile-session-view"
    >
      <div className={styles.mobileHeader}>
        <button
          className={styles.mobileBackButton}
          onClick={onBack}
          aria-label="Back to agent list"
        >
          ← Back
        </button>
        <button
          className={styles.mobileTypeButton}
          onClick={() => setDialogOpen(true)}
          aria-label="Open text input dialog"
        >
          Type…
        </button>
        <button
          className={styles.mobileEnterButton}
          onClick={() => terminalRef.current?.sendInput("\r")}
          aria-label="Send Enter"
        >
          ↵
        </button>
        <button
          className={styles.mobileEscButton}
          onClick={() => terminalRef.current?.sendInput("\x1b")}
          aria-label="Send Escape"
        >
          Esc
        </button>
        <button
          className={styles.mobileCloseButton}
          onClick={onClose}
          aria-label="Close session"
        >
          ✕
        </button>
      </div>
      <div className={styles.mobileSessionContent}>
        <Terminal ref={terminalRef} agentName={win.agentName} sessionId={win.session.id} />
      </div>
      <MobileInputDialog
        open={dialogOpen}
        onSubmit={handleDialogSubmit}
        onClose={handleDialogClose}
      />
    </div>
  );
}
