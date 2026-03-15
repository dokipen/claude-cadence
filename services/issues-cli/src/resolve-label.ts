import { gql } from "graphql-request";
import { getClient } from "./client.js";
import { isCuid } from "./project-resolver.js";

const LIST_LABELS = gql`
  query ListLabels {
    labels {
      id
      name
    }
  }
`;

/**
 * Fetches all labels once and resolves each name/ID to a CUID.
 * CUIDs are returned directly without a round-trip.
 * Names are matched case-insensitively.
 *
 * Note: assumes the labels list is small enough to fetch in one query
 * (no pagination). This is safe for typical projects with < 100 labels.
 */
export async function resolveLabelIds(namesOrIds: string[]): Promise<string[]> {
  const results: string[] = [];
  const toResolve: { index: number; name: string }[] = [];

  for (let i = 0; i < namesOrIds.length; i++) {
    if (isCuid(namesOrIds[i])) {
      results[i] = namesOrIds[i];
    } else {
      results[i] = ""; // placeholder
      toResolve.push({ index: i, name: namesOrIds[i] });
    }
  }

  if (toResolve.length === 0) {
    return results;
  }

  const client = getClient();
  const data = await client.request<{
    labels: Array<{ id: string; name: string }>;
  }>(LIST_LABELS);

  for (const { index, name } of toResolve) {
    const match = data.labels.find(
      (l) => l.name.toLowerCase() === name.toLowerCase(),
    );
    if (!match) {
      throw new Error(
        `Label not found: "${name}". Run "issues label list" to see available labels.`,
      );
    }
    results[index] = match.id;
  }

  return results;
}

/**
 * Resolves a single label identifier to a CUID.
 * Convenience wrapper around resolveLabelIds.
 */
export async function resolveLabelId(nameOrId: string): Promise<string> {
  const [id] = await resolveLabelIds([nameOrId]);
  return id;
}
