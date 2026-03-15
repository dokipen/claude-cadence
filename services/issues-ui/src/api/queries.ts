import { gql } from "graphql-request";

export const AUTHENTICATE_WITH_PAT = gql`
  mutation AuthenticateWithPAT($token: String!) {
    authenticateWithGitHubPAT(token: $token) {
      token
      refreshToken
      user {
        id
        login
        displayName
        avatarUrl
      }
    }
  }
`;

export const LOGOUT_MUTATION = gql`
  mutation Logout($refreshToken: String!) {
    logout(refreshToken: $refreshToken)
  }
`;

export const ME_QUERY = gql`
  query Me {
    me {
      id
      login
      displayName
      avatarUrl
    }
  }
`;
