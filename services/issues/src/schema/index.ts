import { ticketTypeDefs } from "./typeDefs/ticket.js";
import { authTypeDefs } from "./typeDefs/auth.js";
import { ticketResolvers } from "./resolvers/ticket.js";
import { authResolvers } from "./resolvers/auth.js";

export const typeDefs = [ticketTypeDefs, authTypeDefs];
export const resolvers = [ticketResolvers, authResolvers];
