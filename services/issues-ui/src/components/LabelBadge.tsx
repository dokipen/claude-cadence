import type { Label } from "../types";
import styles from "../styles/card.module.css";

export function LabelBadge({ label }: { label: Label }) {
  return (
    <span
      className={styles.labelBadge}
      style={{ backgroundColor: label.color + "22", color: label.color, borderColor: label.color + "44" }}
      data-testid="label-badge"
    >
      {label.name}
    </span>
  );
}
