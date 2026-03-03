import type { OpenGramClient } from "./api-client.js";
/**
 * Called from deliver(kind: "block") in the inbound handler.
 * Receives accumulated text from OpenClaw's block streaming, diffs against
 * the last sent length, and sends only the delta to OpenGram's chunk API.
 *
 * @param dispatchId Unique per inbound message processing — prevents concurrent collisions.
 * @param payload    The reply payload containing accumulated text.
 */
export declare function handleBlockReply(client: OpenGramClient, chatId: string, agentId: string, dispatchId: string, payload: {
    text?: string;
}): Promise<void>;
/**
 * Called when the agent reply is finalized (from deliver(kind: "final")).
 * Completes the streaming message with final text, or (when no final text is
 * provided) finalizes from streamed chunks.
 *
 * @returns true if a stream was active and completed, false if no stream existed.
 */
export declare function finalizeStream(client: OpenGramClient, dispatchId: string, finalText?: string): Promise<boolean>;
/**
 * Called on error/abort to cancel any active stream for a dispatch.
 * Fire-and-forget: errors are silently swallowed.
 */
export declare function cancelStream(client: OpenGramClient, dispatchId: string): void;
/**
 * Pre-seed the activeStreams map so that handleBlockReply reuses the existing
 * message instead of creating a new one. Called eagerly when the inbound
 * handler starts processing, before the SDK dispatch, so the frontend sees
 * stream_state:'streaming' immediately (typing indicator).
 */
export declare function initStream(dispatchId: string, chatId: string, messageId: string, agentId: string): void;
/**
 * Check if a dispatch currently has an active stream.
 * Useful for testing.
 */
export declare function hasActiveStream(dispatchId: string): boolean;
/**
 * Cancel all active streams for a given chat.
 * Used as a safety net when superseding dispatches — ensures no orphaned
 * streaming messages remain for the chat.
 */
export declare function cancelAllStreamsForChat(client: OpenGramClient, chatId: string): void;
/**
 * Clear all active streams. Only for testing.
 */
export declare function clearActiveStreamsForTests(): void;
