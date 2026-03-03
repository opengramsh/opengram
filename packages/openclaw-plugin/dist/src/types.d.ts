export type OpenClawConfig = {
    channels?: {
        opengram?: {
            name?: string;
            enabled?: boolean;
            baseUrl?: string;
            instanceSecret?: string;
            agents?: string[];
            reconnectDelayMs?: number;
        };
    };
};
export type Chat = {
    id: string;
    title?: string;
    title_source?: 'default' | 'auto' | 'manual';
    agent_ids?: string[];
    [key: string]: unknown;
};
export type Message = {
    id: string;
    [key: string]: unknown;
};
export type Media = {
    id: string;
    [key: string]: unknown;
};
export type OGRequest = {
    id: string;
    [key: string]: unknown;
};
export type SearchResult = {
    chats: unknown[];
    messages: unknown[];
    [key: string]: unknown;
};
export type ListChatsResponse = {
    data: Chat[];
    cursor: {
        next?: string;
        hasMore: boolean;
    };
};
import type { TSchema } from "@sinclair/typebox";
export type TextContent = {
    type: "text";
    text: string;
};
export type AgentToolResult<T = unknown> = {
    content: TextContent[];
    details: T;
};
/**
 * Matches the real AgentTool interface from @mariozechner/pi-agent-core.
 * Channel-scoped tools returned by ChannelPlugin.agentTools must conform to this.
 */
export type AgentTool = {
    name: string;
    label: string;
    description: string;
    parameters: TSchema;
    execute: (toolCallId: string, params: any, signal?: AbortSignal) => Promise<AgentToolResult>;
};
