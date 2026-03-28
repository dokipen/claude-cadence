import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export interface TicketCreateParams {
    title: string;
    description?: string;
    acceptanceCriteria?: string;
    labelIds?: string[];
    priority?: string;
    storyPoints?: number;
    projectId?: string;
}
export declare function ticketCreate(params: TicketCreateParams): Promise<CallToolResult>;
export interface TicketGetParams {
    id?: string;
    number?: number;
    projectId?: string;
}
export declare function ticketGet(params: TicketGetParams): Promise<CallToolResult>;
export interface TicketListParams {
    state?: string;
    labelNames?: string[];
    priority?: string;
    isBlocked?: boolean;
    limit?: number;
    projectId?: string;
}
export declare function ticketList(params: TicketListParams): Promise<CallToolResult>;
export interface TicketUpdateParams {
    id: string;
    title?: string;
    description?: string;
    acceptanceCriteria?: string;
    priority?: string;
    storyPoints?: number;
}
export declare function ticketUpdate(params: TicketUpdateParams): Promise<CallToolResult>;
export interface TicketTransitionParams {
    id: string;
    to: string;
}
export declare function ticketTransition(params: TicketTransitionParams): Promise<CallToolResult>;
