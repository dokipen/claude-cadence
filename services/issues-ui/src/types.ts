export interface User {
  id: string;
  login: string;
  displayName: string;
  avatarUrl?: string;
}

export interface AuthPayload {
  token: string;
  refreshToken: string;
  user: User;
}

export type TicketState = "BACKLOG" | "REFINED" | "IN_PROGRESS" | "CLOSED";
export type Priority = "HIGHEST" | "HIGH" | "MEDIUM" | "LOW" | "LOWEST";

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Ticket {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  state: TicketState;
  storyPoints?: number;
  priority: Priority;
  assignee?: User;
  labels: Label[];
  blockedBy: { id: string }[];
}

export interface Project {
  id: string;
  name: string;
  repository?: string;
}
