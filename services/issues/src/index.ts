import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { PrismaClient } from "@prisma/client";
import { DateTimeResolver } from "graphql-scalars";
import { typeDefs, resolvers } from "./schema/index.js";
import { createLoaders } from "./loaders.js";
import { buildAuthContext } from "./auth/context.js";
import { authGuardPlugin } from "./auth/guard.js";
import { rateLimitPlugin } from "./auth/rate-limit-plugin.js";
import { isProduction } from "./env.js";
import { startCleanupSchedule } from "./auth/cleanup.js";
import { formatError } from "./format-error.js";

const prisma = new PrismaClient();

const server = new ApolloServer({
  typeDefs,
  resolvers: [
    ...resolvers,
    { DateTime: DateTimeResolver },
  ],
  introspection: !isProduction,
  plugins: [rateLimitPlugin(), authGuardPlugin()],
  formatError,
});

const port = parseInt(process.env.PORT || "4000", 10);

const { url } = await startStandaloneServer(server, {
  listen: { port },
  context: async ({ req }) => {
    const { currentUser } = await buildAuthContext(
      { headers: { authorization: req.headers.authorization } },
      prisma
    );
    // Only trust X-Forwarded-For when running behind a reverse proxy.
    // Set TRUST_PROXY=true when deployed behind Caddy/nginx.
    const trustProxy = process.env.TRUST_PROXY === "true";
    const forwarded = trustProxy ? req.headers["x-forwarded-for"] : undefined;
    const clientIp = typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : req.socket?.remoteAddress;
    return {
      prisma,
      loaders: createLoaders(prisma),
      currentUser,
      clientIp,
    };
  },
});

console.log(`Server ready at ${url}`);

const cleanupTimer = startCleanupSchedule(prisma);

process.on("SIGTERM", () => {
  clearTimeout(cleanupTimer);
});
