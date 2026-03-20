import { useState, useCallback, useRef, useEffect } from "react";
import { TerminalWindow } from "./TerminalWindow";
import type { Session } from "../types";
import styles from "../styles/agents.module.css";

export interface TiledWindow {
  key: string;
  session: Session;
  agentName: string;
}

interface TilingLayoutProps {
  windows: TiledWindow[];
  onMinimize: (key: string) => void;
  onTerminated: (key: string) => void;
}

// Recursive binary split tree
interface SplitNode {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number; // 0-1, size of first child
  first: LayoutNode;
  second: LayoutNode;
}

interface LeafNode {
  type: "leaf";
  windowKey: string;
}

type LayoutNode = SplitNode | LeafNode;

function buildLayout(keys: string[]): LayoutNode | null {
  if (keys.length === 0) return null;
  if (keys.length === 1) return { type: "leaf", windowKey: keys[0] };
  if (keys.length === 2) {
    return {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "leaf", windowKey: keys[0] },
      second: { type: "leaf", windowKey: keys[1] },
    };
  }
  // Split: first half on the left, second half on the right
  // For 3: left gets 1, right gets 2 (stacked vertically)
  // For 4: left gets 2 (stacked), right gets 2 (stacked)
  const mid = Math.ceil(keys.length / 2);
  const leftKeys = keys.slice(0, mid);
  const rightKeys = keys.slice(mid);

  return {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    first: leftKeys.length === 1
      ? { type: "leaf", windowKey: leftKeys[0] }
      : buildVerticalSplit(leftKeys),
    second: rightKeys.length === 1
      ? { type: "leaf", windowKey: rightKeys[0] }
      : buildVerticalSplit(rightKeys),
  };
}

function buildVerticalSplit(keys: string[]): LayoutNode {
  if (keys.length === 1) return { type: "leaf", windowKey: keys[0] };
  const mid = Math.ceil(keys.length / 2);
  return {
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    first: buildVerticalSplit(keys.slice(0, mid)),
    second: buildVerticalSplit(keys.slice(mid)),
  };
}

export function TilingLayout({ windows, onMinimize, onTerminated }: TilingLayoutProps) {
  const windowMap = new Map(windows.map((w) => [w.key, w]));
  const keys = windows.map((w) => w.key);
  const layout = buildLayout(keys);
  const [ratios, setRatios] = useState<Map<string, number>>(new Map());
  const draggingRef = useRef<{ path: string; direction: "horizontal" | "vertical"; startPos: number; startRatio: number; containerSize: number } | null>(null);

  // Prune stale ratio entries when layout changes
  const keysJson = JSON.stringify(keys);
  useEffect(() => {
    setRatios((prev) => {
      if (prev.size === 0) return prev;
      // Build the set of valid paths for the current layout
      const validPaths = new Set<string>();
      function collectPaths(node: LayoutNode | null, path: string) {
        if (!node || node.type === "leaf") return;
        validPaths.add(path);
        collectPaths(node.first, `${path}.0`);
        collectPaths(node.second, `${path}.1`);
      }
      collectPaths(layout, "root");
      const pruned = new Map<string, number>();
      for (const [path, ratio] of prev) {
        if (validPaths.has(path)) pruned.set(path, ratio);
      }
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [keysJson]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseDown = useCallback((e: React.MouseEvent, path: string, direction: "horizontal" | "vertical") => {
    e.preventDefault();
    const container = (e.target as HTMLElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startPos = direction === "horizontal" ? e.clientX : e.clientY;
    const containerSize = direction === "horizontal" ? rect.width : rect.height;
    const currentRatio = ratios.get(path) ?? 0.5;

    draggingRef.current = { path, direction, startPos, startRatio: currentRatio, containerSize };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const { path, direction, startPos, startRatio, containerSize } = draggingRef.current;
      const currentPos = direction === "horizontal" ? ev.clientX : ev.clientY;
      const delta = (currentPos - startPos) / containerSize;
      const newRatio = Math.max(0.15, Math.min(0.85, startRatio + delta));
      setRatios((prev) => new Map(prev).set(path, newRatio));
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, [ratios]);

  if (!layout) {
    return (
      <div className={styles.tilingEmpty} data-testid="tiling-area">
        <p>Click a session in the sidebar to open a terminal.</p>
      </div>
    );
  }

  function renderNode(node: LayoutNode, path: string): React.ReactNode {
    if (node.type === "leaf") {
      const win = windowMap.get(node.windowKey);
      if (!win) return null;
      return (
        <TerminalWindow
          key={win.key}
          session={win.session}
          agentName={win.agentName}
          onMinimize={() => onMinimize(win.key)}
          onTerminated={() => onTerminated(win.key)}
        />
      );
    }

    const ratio = ratios.get(path) ?? node.ratio;
    const isHorizontal = node.direction === "horizontal";

    return (
      <div
        className={isHorizontal ? styles.tileSplitH : styles.tileSplitV}
        data-testid="tile-split"
      >
        <div style={{ flex: `${ratio} 1 0%`, minWidth: 0, minHeight: 0, display: "flex" }}>
          {renderNode(node.first, `${path}.0`)}
        </div>
        <div
          className={isHorizontal ? styles.tileDividerH : styles.tileDividerV}
          data-testid="tile-divider"
          onMouseDown={(e) => handleMouseDown(e, path, node.direction)}
        />
        <div style={{ flex: `${1 - ratio} 1 0%`, minWidth: 0, minHeight: 0, display: "flex" }}>
          {renderNode(node.second, `${path}.1`)}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tilingArea} data-testid="tiling-area">
      {layout.type === "leaf" ? (
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
          {renderNode(layout, "root")}
        </div>
      ) : (
        renderNode(layout, "root")
      )}
    </div>
  );
}
