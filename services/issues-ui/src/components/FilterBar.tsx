import type { Label, Priority } from "../types";
import type { TicketFilters } from "../hooks/useTickets";
import { useLabels } from "../hooks/useLabels";
import styles from "../styles/filter.module.css";

const PRIORITIES: Priority[] = ["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"];

interface FilterBarProps {
  filters: TicketFilters;
  onChange: (filters: TicketFilters) => void;
}

function hasActiveFilters(filters: TicketFilters): boolean {
  return !!(filters.labelName || filters.isBlocked !== undefined || filters.priority);
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const { labels } = useLabels();

  return (
    <div className={styles.filterBar} data-testid="filter-bar">
      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Label</span>
        <select
          className={styles.filterSelect}
          value={filters.labelName ?? ""}
          onChange={(e) =>
            onChange({ ...filters, labelName: e.target.value || undefined })
          }
          data-testid="filter-label"
        >
          <option value="">All</option>
          {labels.map((label: Label) => (
            <option key={label.id} value={label.name}>
              {label.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Blocked</span>
        <button
          className={`${styles.toggleButton} ${filters.isBlocked === true ? styles.toggleActive : ""}`}
          onClick={() =>
            onChange({
              ...filters,
              isBlocked: filters.isBlocked === true ? undefined : true,
            })
          }
          data-testid="filter-blocked"
        >
          Blocked
        </button>
        <button
          className={`${styles.toggleButton} ${filters.isBlocked === false ? styles.toggleActive : ""}`}
          onClick={() =>
            onChange({
              ...filters,
              isBlocked: filters.isBlocked === false ? undefined : false,
            })
          }
          data-testid="filter-unblocked"
        >
          Unblocked
        </button>
      </div>

      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Priority</span>
        <select
          className={styles.filterSelect}
          value={filters.priority ?? ""}
          onChange={(e) =>
            onChange({
              ...filters,
              priority: (e.target.value as Priority) || undefined,
            })
          }
          data-testid="filter-priority"
        >
          <option value="">All</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0) + p.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      {hasActiveFilters(filters) && (
        <button
          className={styles.clearButton}
          onClick={() => onChange({})}
          data-testid="filter-clear"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
