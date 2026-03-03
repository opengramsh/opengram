import type { DispatchClaimResponse, OpenGramClient } from "./api-client.js";
import { type OpenClawConfig } from "openclaw/plugin-sdk";
export type InboundListenerParams = {
    client: OpenGramClient;
    cfg: OpenClawConfig;
    abortSignal: AbortSignal;
    log?: {
        info(msg: string): void;
        warn(msg: string): void;
        error(msg: string): void;
    };
    reconnectDelayMs: number;
    /** Injected dispatch function — allows tests to supply a mock. */
    dispatch?: DispatchFn;
};
/**
 * The deliver callback signature expected by the buffered dispatcher.
 * `kind` differentiates block (streaming) from final (complete) and tool replies.
 */
export type DeliverKind = "block" | "final" | "tool";
export type ReplyPayload = {
    text?: string;
    mediaUrl?: string;
};
type ImageContent = {
    type: "image";
    data: string;
    mimeType: string;
};
export type DispatchFn = (opts: {
    chatId: string;
    agentId: string;
    messageId: string;
    content: string;
    mediaUrl?: string;
    images?: ImageContent[];
    cfg: OpenClawConfig;
    deliver: (payload: ReplyPayload, meta: {
        kind: DeliverKind;
    }) => Promise<void>;
    onCleanup: () => void;
    onError: (err: unknown) => void;
}) => void | Promise<void>;
type ProcessClaimedBatchResult = {
    skipped: boolean;
};
/**
 * Start the SSE listener for inbound messages from OpenGram.
 * Returns a Promise that resolves when abortSignal fires (lifecycle handle).
 */
export declare function startInboundListener(params: InboundListenerParams): Promise<void>;
export declare function processClaimedDispatchBatch(args: {
    batch: DispatchClaimResponse;
    cfg: OpenClawConfig;
    client: OpenGramClient;
    log?: InboundListenerParams["log"];
    dispatch?: DispatchFn;
}): Promise<ProcessClaimedBatchResult>;
/** Clear dedup set. Only for testing. */
export declare function clearProcessedIdsForTests(): void;
export {};
