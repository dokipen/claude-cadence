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

/**
 * Resolve the project ID from the --project flag or by inferring from git origin.
 * Explicit --project always takes precedence.
 *
 * Throws with a user-facing message if inference fails.
 */
export async function resolveProjectId(explicitProject: string | undefined): Promise<string> {
  if (explicitProject) return explicitProject;

  const slug = getRepoSlugFromOrigin();
  if (!slug) {
    throw new Error(
      "Could not determine project: no --project flag provided and no git remote origin found.\n" +
      "Either pass --project <id> or run from within a git repository with a remote origin."
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
      "Create a project with this repository or pass --project <id> explicitly."
    );
  }

  const names = matches.map((p) => `  - ${p.name} (${p.id})`).join("\n");
  throw new Error(
    `Multiple projects match repository "${slug}":\n${names}\n` +
    "Pass --project <id> to select one."
  );
}
