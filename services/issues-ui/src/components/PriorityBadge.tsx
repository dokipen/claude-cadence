import type { Priority } from "../types";
import styles from "../styles/card.module.css";

const PRIORITY_CONFIG: Record<Priority, { label: string; className: string }> = {
  HIGHEST: { label: "Highest", className: styles.priorityHighest },
  HIGH: { label: "High", className: styles.priorityHigh },
  MEDIUM: { label: "Medium", className: styles.priorityMedium },
  LOW: { label: "Low", className: styles.priorityLow },
  LOWEST: { label: "Lowest", className: styles.priorityLowest },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <span
      className={`${styles.priorityBadge} ${config.className}`}
      data-testid="priority-badge"
      data-priority={priority}
    >
      {config.label}
    </span>
  );
}
