export const authTypeDefs = `
  type AuthPayload {
    token: String!
    refreshToken: String!
    user: User!
  }

  extend type Query {
    me: User
  }

  extend type Mutation {
    generateOAuthState: String!
    authenticateWithGitHubCode(code: String!, state: String!): AuthPayload!
    authenticateWithGitHubPAT(token: String!): AuthPayload!
    refreshToken(refreshToken: String!): AuthPayload!
    logout(refreshToken: String!): Boolean!
  }
`;
