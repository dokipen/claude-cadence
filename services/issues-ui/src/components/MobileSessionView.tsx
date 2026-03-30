import { useEffect, useState } from "react";
import { TerminalWindow } from "./TerminalWindow";
import type { TiledWindow } from "./TilingLayout";
import styles from "../styles/agents.module.css";

interface MobileSessionViewProps {
  win: TiledWindow;
  onBack: () => void;
  onMinimize: (key: string) => void;
  onTerminated: (key: string) => void;
}

export function MobileSessionView({ win, onBack, onMinimize, onTerminated }: MobileSessionViewProps) {
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
      <button
        className={styles.mobileBackButton}
        onClick={onBack}
        aria-label="Back to agent list"
      >
        ← Back
      </button>
      <div className={styles.mobileSessionContent}>
        <TerminalWindow
          session={win.session}
          agentName={win.agentName}
          projectId={win.projectId}
          onMinimize={() => onMinimize(win.key)}
          onTerminated={() => onTerminated(win.key)}
        />
      </div>
    </div>
  );
}
