import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { PrismaClient } from "@prisma/client";
import { DateTimeResolver } from "graphql-scalars";
import { typeDefs, resolvers } from "./schema/index.js";
import { createLoaders } from "./loaders.js";

const prisma = new PrismaClient();

const server = new ApolloServer({
  typeDefs,
  resolvers: [
    ...resolvers,
    { DateTime: DateTimeResolver },
  ],
});

const port = parseInt(process.env.PORT || "4000", 10);

const { url } = await startStandaloneServer(server, {
  listen: { port },
  // Fresh loaders per request to avoid cross-request cache pollution
  context: async () => ({
    prisma,
    loaders: createLoaders(prisma),
  }),
});

console.log(`Server ready at ${url}`);
