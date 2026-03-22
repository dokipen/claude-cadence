import { useState, useCallback } from "react";
import type { Label, Priority } from "../types";
import type { TicketFilters } from "../hooks/useTickets";
import { parseCQL } from "../utils/parseCQL";
import { useLabels } from "../hooks/useLabels";
import styles from "../styles/filter.module.css";

const PRIORITIES: Priority[] = ["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"];

type FilterMode = "form" | "cql";

const STORAGE_KEY = "cadence_filter_mode";

function getInitialMode(): FilterMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "cql" || stored === "form") return stored;
  } catch {
    // localStorage unavailable
  }
  return "form";
}

interface FilterBarProps {
  filters: TicketFilters;
  onChange: (filters: TicketFilters) => void;
}

function hasActiveFilters(filters: TicketFilters): boolean {
  return !!(filters.labelName || filters.isBlocked !== undefined || filters.priority || filters.excludeLabelName || filters.excludePriority);
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const { labels } = useLabels();
  const [mode, setMode] = useState<FilterMode>(getInitialMode);
  const [cqlValue, setCqlValue] = useState("");
  const [cqlErrors, setCqlErrors] = useState<string[]>([]);

  const switchToForm = useCallback(() => {
    setMode("form");
    setCqlValue("");
    setCqlErrors([]);
    onChange({});
    try {
      localStorage.setItem(STORAGE_KEY, "form");
    } catch {
      // localStorage unavailable
    }
  }, [onChange]);

  const switchToCql = useCallback(() => {
    setMode("cql");
    onChange({});
    try {
      localStorage.setItem(STORAGE_KEY, "cql");
    } catch {
      // localStorage unavailable
    }
  }, [onChange]);

  const handleCqlChange = useCallback(
    (value: string) => {
      setCqlValue(value);
      if (!value.trim()) {
        setCqlErrors([]);
        onChange({});
        return;
      }
      const { filters: parsed, errors } = parseCQL(value);
      setCqlErrors(errors);
      if (errors.length === 0) {
        onChange(parsed);
      } else {
        onChange({});
      }
    },
    [onChange],
  );

  const cqlInputId = "cql-input";
  const cqlErrorsId = "cql-errors";

  return (
    <div className={styles.filterBar} data-testid="filter-bar">
      <div className={styles.modeToggle} data-testid="filter-mode-toggle">
        <button
          className={`${styles.modeButton} ${mode === "form" ? styles.modeButtonActive : ""}`}
          onClick={switchToForm}
          aria-pressed={mode === "form"}
        >
          Form
        </button>
        <button
          className={`${styles.modeButton} ${mode === "cql" ? styles.modeButtonActive : ""}`}
          onClick={switchToCql}
          aria-pressed={mode === "cql"}
        >
          CQL
        </button>
      </div>

      {mode === "cql" ? (
        <div className={styles.cqlContainer}>
          <label htmlFor={cqlInputId} className={styles.filterLabel}>
            Query
          </label>
          <input
            id={cqlInputId}
            className={styles.cqlInput}
            type="text"
            value={cqlValue}
            onChange={(e) => handleCqlChange(e.target.value)}
            placeholder="label:bug blocked -priority:LOW"
            maxLength={500}
            aria-label="CQL filter query"
            aria-describedby={cqlErrors.length > 0 ? cqlErrorsId : undefined}
            aria-invalid={cqlErrors.length > 0}
            data-testid="cql-input"
          />
          {cqlErrors.length > 0 && (
            <ul
              id={cqlErrorsId}
              className={styles.cqlErrors}
              data-testid="cql-errors"
              role="alert"
            >
              {cqlErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
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
              onChange={(e) => {
                const val = e.target.value;
                onChange({
                  ...filters,
                  priority: PRIORITIES.includes(val as Priority)
                    ? (val as Priority)
                    : undefined,
                });
              }}
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
        </>
      )}
    </div>
  );
}
