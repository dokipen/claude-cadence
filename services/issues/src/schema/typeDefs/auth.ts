export const authTypeDefs = `
  type AuthPayload {
    token: String!
    user: User!
  }

  extend type Query {
    me: User
  }

  extend type Mutation {
    authenticateWithGitHubCode(code: String!): AuthPayload!
    authenticateWithGitHubPAT(token: String!): AuthPayload!
  }
`;
