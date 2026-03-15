import { ticketTypeDefs } from "./typeDefs/ticket.js";
import { projectTypeDefs } from "./typeDefs/project.js";
import { authTypeDefs } from "./typeDefs/auth.js";
import { ticketResolvers } from "./resolvers/ticket.js";
import { projectResolvers } from "./resolvers/project.js";
import { authResolvers } from "./resolvers/auth.js";

export const typeDefs = [ticketTypeDefs, projectTypeDefs, authTypeDefs];
export const resolvers = [ticketResolvers, projectResolvers, authResolvers];
