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

export const LABELS_QUERY = gql`
  query Labels {
    labels {
      id
      name
      color
    }
  }
`;

export const BOARD_TICKETS_QUERY = gql`
  query BoardTickets(
    $state: TicketState
    $projectId: ID
    $first: Int
    $labelName: String
    $isBlocked: Boolean
    $priority: Priority
    $excludeLabelName: String
    $excludePriority: Priority
  ) {
    tickets(
      state: $state
      projectId: $projectId
      first: $first
      labelName: $labelName
      isBlocked: $isBlocked
      priority: $priority
      excludeLabelName: $excludeLabelName
      excludePriority: $excludePriority
    ) {
      edges {
        node {
          id
          number
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
            state
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
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

export const GENERATE_OAUTH_STATE = gql`
  mutation GenerateOAuthState {
    generateOAuthState
  }
`;

export const AUTHENTICATE_WITH_GITHUB_CODE = gql`
  mutation AuthenticateWithGitHubCode($code: String!, $state: String!) {
    authenticateWithGitHubCode(code: $code, state: $state) {
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
        repository
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
