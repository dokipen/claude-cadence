import type { Label } from "../types";
import styles from "../styles/card.module.css";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function safeColor(color: string): string {
  return HEX_COLOR_RE.test(color) ? color : "#6b7280";
}

export function LabelBadge({ label }: { label: Label }) {
  const color = safeColor(label.color);
  return (
    <span
      className={styles.labelBadge}
      style={{ backgroundColor: color + "22", color, borderColor: color + "44" }}
      data-testid="label-badge"
    >
      {label.name}
    </span>
  );
}
