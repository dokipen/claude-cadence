export const ticketTypeDefs = `
  scalar DateTime

  enum TicketState {
    BACKLOG
    REFINED
    IN_PROGRESS
    CLOSED
  }

  enum Priority {
    HIGHEST
    HIGH
    MEDIUM
    LOW
    LOWEST
  }

  type User {
    id: ID!
    githubId: Int!
    login: String!
    displayName: String!
    avatarUrl: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Label {
    id: ID!
    name: String!
    color: String!
    createdAt: DateTime!
  }

  type Comment {
    id: ID!
    body: String!
    ticketId: ID!
    authorId: ID!
    author: User!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Ticket {
    id: ID!
    title: String!
    description: String
    acceptanceCriteria: String
    state: TicketState!
    storyPoints: Int
    priority: Priority!
    assignee: User
    labels: [Label!]!
    comments: [Comment!]!
    blocks: [Ticket!]!
    blockedBy: [Ticket!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type TicketEdge {
    cursor: String!
    node: Ticket!
  }

  type TicketConnection {
    edges: [TicketEdge!]!
    pageInfo: PageInfo!
  }

  input CreateTicketInput {
    title: String!
    description: String
    acceptanceCriteria: String
    labelIds: [ID!]
    assigneeId: ID
    storyPoints: Int
    priority: Priority
  }

  input UpdateTicketInput {
    title: String
    description: String
    acceptanceCriteria: String
    storyPoints: Int
    priority: Priority
  }

  type Query {
    ticket(id: ID!): Ticket
    tickets(
      state: TicketState
      labelName: String
      assigneeLogin: String
      isBlocked: Boolean
      priority: Priority
      first: Int
      after: String
    ): TicketConnection!
    labels: [Label!]!
  }

  type Mutation {
    createTicket(input: CreateTicketInput!): Ticket!
    updateTicket(id: ID!, input: UpdateTicketInput!): Ticket!
    createLabel(name: String!, color: String!): Label!
    addLabel(ticketId: ID!, labelId: ID!): Ticket!
    removeLabel(ticketId: ID!, labelId: ID!): Ticket!
    assignTicket(ticketId: ID!, userId: ID!): Ticket!
    unassignTicket(ticketId: ID!): Ticket!
    createUser(githubId: Int!, login: String!, displayName: String!, avatarUrl: String): User!
  }
`;
