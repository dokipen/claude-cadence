import type { ApolloServerPlugin } from "@apollo/server";
import { GraphQLError } from "graphql";
import type { AuthenticatedContext } from "../schema/resolvers/auth.js";

// Root fields that don't require authentication.
// Introspection fields are only public outside production.
const PUBLIC_FIELDS = new Set([
  "authenticateWithGitHubCode",
  "authenticateWithGitHubPAT",
  ...(process.env.NODE_ENV === "production" ? [] : ["__schema", "__type"]),
]);

/**
 * Apollo Server plugin that enforces authentication on all operations
 * except the public auth mutations (and introspection in non-production).
 *
 * Uses field-level checking: every root field in the operation must be
 * in the PUBLIC_FIELDS set, otherwise authentication is required.
 * This prevents bypass via anonymous operations or mixed queries.
 */
export function authGuardPlugin(): ApolloServerPlugin<AuthenticatedContext> {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation(requestContext) {
          // Already authenticated — allow everything
          if (requestContext.contextValue.currentUser) {
            return;
          }

          // Check if ALL root fields across all definitions are public
          const document = requestContext.document;

          for (const definition of document.definitions) {
            if (definition.kind !== "OperationDefinition") continue;

            for (const sel of definition.selectionSet.selections) {
              if (sel.kind !== "Field" || !PUBLIC_FIELDS.has(sel.name.value)) {
                throw new GraphQLError("Authentication required", {
                  extensions: { code: "UNAUTHENTICATED" },
                });
              }
            }
          }
        },
      };
    },
  };
}
