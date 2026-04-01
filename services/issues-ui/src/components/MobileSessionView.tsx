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
