import { useEffect, useRef, useState } from "react";
import { Terminal } from "./Terminal";
import type { TerminalHandle } from "./Terminal";
import type { TiledWindow } from "./TilingLayout";
import styles from "../styles/agents.module.css";

interface MobileSessionViewProps {
  win: TiledWindow;
  onBack: () => void;
  onClose: () => void;
}

export function MobileSessionView({ win, onBack, onClose }: MobileSessionViewProps) {
  const terminalRef = useRef<TerminalHandle>(null);
  const [viewportHeight, setViewportHeight] = useState<number>(
    () => window.visualViewport?.height ?? window.innerHeight,
  );

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => setViewportHeight(vv.height);
    vv.addEventListener("resize", handleResize);
    // iOS Safari fires "scroll" on visualViewport (not "resize") when the
    // on-screen keyboard appears or disappears.
    vv.addEventListener("scroll", handleResize);
    // Sync once immediately in case the viewport changed between initial render
    // and this effect running.
    handleResize();
    return () => {
      vv.removeEventListener("resize", handleResize);
      vv.removeEventListener("scroll", handleResize);
    };
  }, []);

  // Lock horizontal scroll on the document while the overlay is visible.
  // On iOS Safari, position:fixed overlays don't prevent the body from being
  // scrolled via touch — locking overflow-x stops any horizontal drift from
  // showing through the terminal view.
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflowX;
    html.style.overflowX = "hidden";
    return () => {
      html.style.overflowX = prev;
    };
  }, []);

  return (
    <div
      className={styles.mobileSessionView}
      style={{ height: viewportHeight }}
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
    </div>
  );
}
