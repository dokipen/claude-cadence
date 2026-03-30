import { useEffect, useState } from "react";
import { Terminal } from "./Terminal";
import type { TiledWindow } from "./TilingLayout";
import styles from "../styles/agents.module.css";

interface MobileSessionViewProps {
  win: TiledWindow;
  onBack: () => void;
  onClose: () => void;
}

export function MobileSessionView({ win, onBack, onClose }: MobileSessionViewProps) {
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
          className={styles.mobileCloseButton}
          onClick={onClose}
          aria-label="Close session"
        >
          ✕
        </button>
      </div>
      <div className={styles.mobileSessionContent}>
        <Terminal agentName={win.agentName} sessionId={win.session.id} />
      </div>
    </div>
  );
}
