import { gql } from "graphql-request";
import { getClient } from "./client.js";
import { getRepoSlugFromOrigin } from "./git.js";

const LIST_PROJECTS = gql`
  query ListProjects {
    projects {
      id
      name
      repository
    }
  }
`;

const GET_PROJECT_BY_NAME = gql`
  query GetProjectByName($name: String!) {
    projectByName(name: $name) {
      id
      name
    }
  }
`;

/**
 * CUIDs are 25-character lowercase alphanumeric strings starting with 'c'.
 *
 * Note: This is a heuristic. A project name that happens to match the CUID
 * pattern would be treated as an ID. In practice this is unlikely since
 * project names are human-readable strings like "claude-cadence".
 */
function isCuid(value: string): boolean {
  return /^c[a-z0-9]{24,}$/.test(value);
}

/**
 * Resolve the project ID from the --project flag or by inferring from git origin.
 *
 * Resolution order:
 * 1. If explicit value looks like a CUID, return it as-is
 * 2. If explicit value is given but not a CUID, look it up by name
 * 3. If no value given, infer from git remote origin
 *
 * Throws with a user-facing message if resolution fails.
 */
export async function resolveProjectId(explicitProject: string | undefined): Promise<string> {
  if (explicitProject) {
    if (isCuid(explicitProject)) {
      return explicitProject;
    }

    // Treat as a project name and resolve via API
    const client = getClient();
    const data = await client.request<{
      projectByName: { id: string; name: string } | null;
    }>(GET_PROJECT_BY_NAME, { name: explicitProject });

    if (!data.projectByName) {
      throw new Error(
        `Project not found: "${explicitProject}". Use 'issues project list' to see available projects.`
      );
    }

    return data.projectByName.id;
  }

  // No explicit project — infer from git remote origin
  const slug = getRepoSlugFromOrigin();
  if (!slug) {
    throw new Error(
      "Could not determine project: no --project flag provided and no git remote origin found.\n" +
      "Either pass --project <name-or-id> or run from within a git repository with a remote origin."
    );
  }

  const client = getClient();
  const data = await client.request<{
    projects: Array<{ id: string; name: string; repository: string }>;
  }>(LIST_PROJECTS);

  const matches = data.projects.filter(
    (p) => p.repository.toLowerCase() === slug.toLowerCase()
  );

  if (matches.length === 1) {
    return matches[0].id;
  }

  if (matches.length === 0) {
    throw new Error(
      `No project found matching repository "${slug}".\n` +
      "Create a project with this repository or pass --project <name-or-id> explicitly."
    );
  }

  const names = matches.map((p) => `  - ${p.name} (${p.id})`).join("\n");
  throw new Error(
    `Multiple projects match repository "${slug}":\n${names}\n` +
    "Pass --project <name-or-id> to select one."
  );
}
