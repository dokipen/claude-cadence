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
    number: Int!
    title: String!
    description: String
    acceptanceCriteria: String
    state: TicketState!
    storyPoints: Int
    priority: Priority!
    assignee: User
    project: Project!
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
    projectId: ID!
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
    ticketByNumber(projectId: ID!, number: Int!): Ticket
    tickets(
      state: TicketState
      labelName: String
      assigneeLogin: String
      isBlocked: Boolean
      priority: Priority
      projectId: ID
      "Maximum number of tickets to return. Server-side cap: 100."
      first: Int
      "Cursor for forward pagination. Use the endCursor from a previous query's pageInfo."
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
    transitionTicket(id: ID!, to: TicketState!): Ticket!
    addBlockRelation(blockerId: ID!, blockedId: ID!): Ticket!
    removeBlockRelation(blockerId: ID!, blockedId: ID!): Ticket!
    addComment(ticketId: ID!, body: String!): Comment!
    updateComment(id: ID!, body: String!): Comment!
    deleteComment(id: ID!): Comment!
  }
`;
