import { gql } from "graphql-request";
import { getClient } from "./client.js";
import { getCachedProjectIdByName, cacheProjectIdByName } from "./config.js";

const GET_PROJECT_BY_NAME = gql`
  query GetProjectByName($name: String!) {
    projectByName(name: $name) {
      id
      name
    }
  }
`;

/**
 * Resolve a project name to its CUID. Results are cached in-session so repeated
 * calls for the same name incur only one GraphQL round-trip.
 */
export async function resolveProjectName(name: string): Promise<string> {
  const cached = getCachedProjectIdByName(name);
  if (cached !== undefined) {
    return cached;
  }

  const client = getClient();
  const data = await client.request<{
    projectByName: { id: string; name: string } | null;
  }>(GET_PROJECT_BY_NAME, { name });

  if (!data.projectByName) {
    throw new Error(`Project not found: "${name}"`);
  }

  cacheProjectIdByName(name, data.projectByName.id);
  return data.projectByName.id;
}
