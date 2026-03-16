import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { PrismaClient } from "@prisma/client";
import { DateTimeResolver } from "graphql-scalars";
import { typeDefs, resolvers } from "./schema/index.js";
import { createLoaders } from "./loaders.js";
import { buildAuthContext } from "./auth/context.js";
import { authGuardPlugin } from "./auth/guard.js";
import { isProduction } from "./env.js";
import { startCleanupSchedule } from "./auth/cleanup.js";

const prisma = new PrismaClient();

const server = new ApolloServer({
  typeDefs,
  resolvers: [
    ...resolvers,
    { DateTime: DateTimeResolver },
  ],
  introspection: !isProduction,
  plugins: [authGuardPlugin()],
});

const port = parseInt(process.env.PORT || "4000", 10);

const { url } = await startStandaloneServer(server, {
  listen: { port },
  context: async ({ req }) => {
    const { currentUser } = await buildAuthContext(
      { headers: { authorization: req.headers.authorization } },
      prisma
    );
    return {
      prisma,
      loaders: createLoaders(prisma),
      currentUser,
    };
  },
});

console.log(`Server ready at ${url}`);

startCleanupSchedule(prisma);
