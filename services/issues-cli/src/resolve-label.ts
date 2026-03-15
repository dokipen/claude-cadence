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
 * Resolves a label identifier to a CUID.
 * If the identifier looks like a CUID, returns it directly.
 * Otherwise, looks up the label by name (case-insensitive).
 */
export async function resolveLabelId(nameOrId: string): Promise<string> {
  if (isCuid(nameOrId)) {
    return nameOrId;
  }

  const client = getClient();
  const data = await client.request<{
    labels: Array<{ id: string; name: string }>;
  }>(LIST_LABELS);

  const match = data.labels.find(
    (l) => l.name.toLowerCase() === nameOrId.toLowerCase(),
  );

  if (!match) {
    const available = data.labels.map((l) => l.name).join(", ");
    throw new Error(
      `Label not found: "${nameOrId}". Available labels: ${available}`,
    );
  }

  return match.id;
}
