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
  number: number;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  state: TicketState;
  storyPoints?: number;
  priority: Priority;
  assignee?: User;
  labels: Label[];
  blockedBy: { id: string; state: TicketState }[];
}

export interface Comment {
  id: string;
  body: string;
  author: User;
  createdAt: string;
}

export interface RelatedTicket {
  id: string;
  number: number;
  title: string;
  state: TicketState;
}

export interface TicketDetail extends Ticket {
  project: Project;
  comments: Comment[];
  blocks: RelatedTicket[];
  blockedBy: RelatedTicket[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  repository?: string;
}

// Agent Hub types — generated from services/agent-hub/proto/hub/v1/hub.proto
export type { Agent, AgentProfile, Session, CreateSessionRequest } from "./gen/hub/v1/hub_pb";
export type AgentStatus = "online" | "offline";
export type SessionState = "creating" | "running" | "stopped" | "error" | "destroying";

export interface ActiveSessionInfo {
  name: string;
  state: SessionState;
}
