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

export const BOARD_TICKETS_QUERY = gql`
  query BoardTickets($state: TicketState!, $projectId: ID!, $first: Int) {
    tickets(state: $state, projectId: $projectId, first: $first) {
      edges {
        node {
          id
          title
          state
          priority
          storyPoints
          assignee {
            login
            avatarUrl
          }
          labels {
            id
            name
            color
          }
          blockedBy {
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PROJECTS_QUERY = gql`
  query Projects {
    projects {
      id
      name
      repository
    }
  }
`;

export const TICKET_DETAIL_QUERY = gql`
  query TicketDetail($id: ID!) {
    ticket(id: $id) {
      id
      number
      title
      description
      acceptanceCriteria
      state
      storyPoints
      priority
      assignee {
        id
        login
        displayName
        avatarUrl
      }
      project {
        id
        name
      }
      labels {
        id
        name
        color
      }
      comments {
        id
        body
        author {
          id
          login
          displayName
          avatarUrl
        }
        createdAt
      }
      blocks {
        id
        number
        title
        state
      }
      blockedBy {
        id
        number
        title
        state
      }
      createdAt
      updatedAt
    }
  }
`;
