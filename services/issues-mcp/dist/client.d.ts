import { GraphQLClient } from "graphql-request";
export declare function is429Error(error: unknown): boolean;
export declare function getRetryAfterMs(error: unknown): number | null;
/**
 * Returns a GraphQL client with 429 retry logic using exponential backoff.
 * No token refresh — MCP servers use long-lived tokens.
 */
export declare function getClient(): GraphQLClient;
