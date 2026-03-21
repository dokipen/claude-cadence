import type { Priority } from "../types";

export interface ParsedCQLFilters {
  labelName?: string;
  excludeLabelName?: string;
  isBlocked?: boolean;
  priority?: Priority;
  excludePriority?: Priority;
}

const VALID_PRIORITIES = new Set<string>(["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"]);

function isValidPriority(value: string): value is Priority {
  return VALID_PRIORITIES.has(value.toUpperCase());
}

export function parseCQL(query: string): { filters: ParsedCQLFilters; errors: string[] } {
  const filters: ParsedCQLFilters = {};
  const errors: string[] = [];

  const trimmed = query.trim();
  if (!trimmed) {
    return { filters, errors };
  }

  const tokens = trimmed.split(/\s+/);

  for (const token of tokens) {
    const negated = token.startsWith("-");
    const raw = negated ? token.slice(1) : token;

    // blocked / -blocked
    if (raw === "blocked") {
      const value = !negated;
      if (filters.isBlocked !== undefined && filters.isBlocked !== value) {
        errors.push(`Conflicting operators: "blocked" and "-blocked"`);
      } else {
        filters.isBlocked = value;
      }
      continue;
    }

    // label:NAME / -label:NAME
    if (raw.startsWith("label:")) {
      const name = raw.slice("label:".length);
      if (!name) {
        errors.push(`Unknown token: "${token}"`);
        continue;
      }
      if (negated) {
        if (filters.excludeLabelName !== undefined && filters.excludeLabelName !== name) {
          errors.push(`Conflicting operators: multiple -label filters`);
        } else {
          filters.excludeLabelName = name;
        }
      } else {
        if (filters.labelName !== undefined && filters.labelName !== name) {
          errors.push(`Conflicting operators: multiple label filters`);
        } else {
          filters.labelName = name;
        }
      }
      continue;
    }

    // priority:N / -priority:N
    if (raw.startsWith("priority:")) {
      const value = raw.slice("priority:".length).toUpperCase();
      if (!value || !isValidPriority(value)) {
        errors.push(`Unknown token: "${token}"`);
        continue;
      }
      const priority = value as Priority;
      if (negated) {
        if (filters.excludePriority !== undefined && filters.excludePriority !== priority) {
          errors.push(`Conflicting operators: multiple -priority filters`);
        } else {
          filters.excludePriority = priority;
        }
      } else {
        if (filters.priority !== undefined && filters.priority !== priority) {
          errors.push(`Conflicting operators: multiple priority filters`);
        } else {
          filters.priority = priority;
        }
      }
      continue;
    }

    errors.push(`Unknown token: "${token}"`);
  }

  // Post-parse conflict checks: same-value include/exclude
  if (
    filters.labelName !== undefined &&
    filters.excludeLabelName !== undefined &&
    filters.labelName.toLowerCase() === filters.excludeLabelName.toLowerCase()
  ) {
    const value = filters.labelName;
    errors.push(`Conflicting filter: label:${value} and -label:${value} cannot be combined`);
    delete filters.labelName;
    delete filters.excludeLabelName;
  }

  if (
    filters.priority !== undefined &&
    filters.excludePriority !== undefined &&
    filters.priority === filters.excludePriority
  ) {
    const value = filters.priority;
    errors.push(`Conflicting filter: priority:${value} and -priority:${value} cannot be combined`);
    delete filters.priority;
    delete filters.excludePriority;
  }

  return { filters, errors };
}
