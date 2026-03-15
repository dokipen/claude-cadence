export const projectTypeDefs = `
  type Project {
    id: ID!
    name: String!
    repository: String!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  input CreateProjectInput {
    name: String!
    repository: String!
  }

  input UpdateProjectInput {
    name: String
    repository: String
  }

  extend type Query {
    project(id: ID!): Project
    projects: [Project!]!
  }

  extend type Mutation {
    createProject(input: CreateProjectInput!): Project!
    updateProject(id: ID!, input: UpdateProjectInput!): Project!
  }
`;
