import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export declare function labelList(): Promise<CallToolResult>;
export interface LabelAddParams {
    ticketId: string;
    labelId: string;
}
export declare function labelAdd(params: LabelAddParams): Promise<CallToolResult>;
export interface LabelRemoveParams {
    ticketId: string;
    labelId: string;
}
export declare function labelRemove(params: LabelRemoveParams): Promise<CallToolResult>;
