import type { ApolloServerPlugin } from "@apollo/server";
import { GraphQLError } from "graphql";
import type { AuthenticatedContext } from "../schema/resolvers/auth.js";

// Operations that don't require authentication
const PUBLIC_OPERATIONS = new Set([
  "authenticateWithGitHubCode",
  "authenticateWithGitHubPAT",
  "IntrospectionQuery",
]);

/**
 * Apollo Server plugin that enforces authentication on all operations
 * except the public auth mutations and introspection.
 */
export function authGuardPlugin(): ApolloServerPlugin<AuthenticatedContext> {
  return {
    async requestDidStart() {
      return {
        async didResolveOperation(requestContext) {
          const operationName = requestContext.operationName;

          // Allow public operations by name
          if (operationName && PUBLIC_OPERATIONS.has(operationName)) {
            return;
          }

          // Check if all root fields are public
          const document = requestContext.document;
          const definitions = document.definitions;

          for (const definition of definitions) {
            if (definition.kind !== "OperationDefinition") continue;

            const selections = definition.selectionSet.selections;
            const allPublic = selections.every((sel) => {
              if (sel.kind === "Field") {
                return PUBLIC_OPERATIONS.has(sel.name.value) || sel.name.value === "__schema" || sel.name.value === "__type";
              }
              return false;
            });

            if (allPublic) return;
          }

          // Require authentication for everything else
          if (!requestContext.contextValue.currentUser) {
            throw new GraphQLError("Authentication required", {
              extensions: { code: "UNAUTHENTICATED" },
            });
          }
        },
      };
    },
  };
}
