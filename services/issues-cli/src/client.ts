import { GraphQLClient } from "graphql-request";
import { getApiUrl, getAuthToken } from "./config.js";

export function getClient(): GraphQLClient {
  const url = getApiUrl();
  const token = getAuthToken();

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return new GraphQLClient(url, { headers });
}
