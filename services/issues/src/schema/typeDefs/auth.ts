export const authTypeDefs = `
  type AuthPayload {
    token: String!
    user: User!
  }

  extend type Query {
    me: User
  }

  extend type Mutation {
    generateOAuthState: String!
    authenticateWithGitHubCode(code: String!, state: String!): AuthPayload!
    authenticateWithGitHubPAT(token: String!): AuthPayload!
  }
`;
