import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export interface CommentAddParams {
    ticketId: string;
    body: string;
}
export declare function commentAdd(params: CommentAddParams): Promise<CallToolResult>;
