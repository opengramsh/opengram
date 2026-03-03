import { EventSource } from "eventsource";
import type { Chat, ListChatsResponse, Media, Message, OGRequest, SearchResult } from "./types.js";
export type DispatchBatchKind = "user_batch" | "request_batch";
export type DispatchBatchItem = {
    inputId: string;
    sourceKind: "user_message" | "request_resolved";
    sourceId: string;
    senderId: string;
    content: string;
    traceKind?: string;
    mediaIds: string[];
    attachmentNames: string[];
};
export type DispatchBatchAttachment = {
    mediaId: string;
    fileName: string;
    kind: "image" | "audio" | "file";
    sourceInputId: string;
    sourceIndex: number;
};
export type DispatchClaimResponse = {
    batchId: string;
    chatId: string;
    kind: DispatchBatchKind;
    agentIdHint: string | null;
    compiledContent: string;
    items: DispatchBatchItem[];
    attachments: DispatchBatchAttachment[];
};
export type OpenGramServerRuntimeConfig = {
    server?: {
        dispatch?: {
            mode?: "immediate" | "sequential" | "batched_sequential";
            leaseMs?: number;
            heartbeatIntervalMs?: number;
            claimWaitMs?: number;
            execution?: {
                autoscaleEnabled?: boolean;
                minConcurrency?: number;
                maxConcurrency?: number;
                scaleCooldownMs?: number;
            };
            claim?: {
                claimManyLimit?: number;
            };
        };
    };
};
export declare class OpenGramClient {
    private readonly baseUrl;
    private readonly instanceSecret?;
    constructor(baseUrl: string, instanceSecret?: string | undefined);
    private headers;
    private fetchWithRetry;
    createChat(params: {
        agentIds: string[];
        modelId: string;
        title?: string;
        tags?: string[];
    }): Promise<Chat>;
    listChats(params?: {
        agentId?: string;
        archived?: boolean;
        cursor?: string;
        limit?: number;
    }): Promise<ListChatsResponse>;
    getMessages(chatId: string, params?: {
        limit?: number;
    }): Promise<Message[]>;
    getChat(chatId: string): Promise<Chat>;
    updateChat(chatId: string, patch: Record<string, unknown>): Promise<Chat>;
    createMessage(chatId: string, params: {
        role: "user" | "agent" | "system" | "tool";
        senderId: string;
        content?: string;
        streaming?: boolean;
        modelId?: string;
        trace?: object;
    }): Promise<Message>;
    sendChunk(messageId: string, deltaText: string): Promise<void>;
    completeMessage(messageId: string, finalText?: string): Promise<void>;
    cancelMessage(messageId: string): Promise<void>;
    cancelStreamingMessagesForChat(chatId: string): Promise<{
        cancelledMessageIds: string[];
    }>;
    uploadMedia(chatId: string, params: {
        file: Buffer;
        filename: string;
        contentType: string;
        messageId?: string;
    }): Promise<Media>;
    getMediaUrl(mediaId: string): string;
    fetchMediaAsImage(mediaId: string): Promise<{
        type: "image";
        data: string;
        mimeType: string;
    } | null>;
    fetchMediaAsBuffer(mediaId: string): Promise<{
        buffer: Buffer;
        mimeType: string;
        fileName: string;
    } | null>;
    createRequest(chatId: string, params: {
        type: "choice" | "text_input" | "form";
        title: string;
        body?: string;
        config: object;
        trace?: object;
    }): Promise<OGRequest>;
    search(query: string, scope?: "all" | "titles" | "messages"): Promise<SearchResult>;
    sendTyping(chatId: string, agentId: string): Promise<void>;
    claimDispatch(params: {
        workerId: string;
        leaseMs?: number;
        waitMs?: number;
    }): Promise<DispatchClaimResponse | null>;
    claimDispatchMany(params: {
        workerId: string;
        leaseMs?: number;
        waitMs?: number;
        limit?: number;
    }): Promise<DispatchClaimResponse[]>;
    heartbeatDispatch(batchId: string, params: {
        workerId: string;
        extendMs?: number;
    }): Promise<void>;
    completeDispatch(batchId: string, workerId: string): Promise<void>;
    failDispatch(batchId: string, params: {
        workerId: string;
        reason: string;
        retryable: boolean;
        retryDelayMs?: number;
    }): Promise<void>;
    health(): Promise<{
        status: string;
        version: string;
        uptime: number;
    }>;
    getConfig(): Promise<OpenGramServerRuntimeConfig>;
    connectSSE(params?: {
        ephemeral?: boolean;
        cursor?: string;
    }): EventSource;
}
