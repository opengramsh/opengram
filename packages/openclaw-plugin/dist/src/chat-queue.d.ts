import type { OpenGramClient } from "./api-client.js";
/**
 * Per-chat dispatch queue.
 *
 * Ensures only one agent dispatch runs per chat at a time.
 * When a new message arrives while a dispatch is active (or even shortly after
 * one finishes), the previous dispatch is superseded: its deliver callbacks
 * become no-ops, its streaming messages are cancelled, and its typing
 * heartbeat is stopped.
 *
 * This prevents orphaned typing bubbles from parallel agent runs.
 */
export type DispatchCallback = (dispatchId: string) => Promise<void>;
/**
 * Enqueue a dispatch for a chat. If a previous dispatch exists for this
 * chat, it is superseded: its deliver callbacks become no-ops, its
 * streaming messages are cancelled, and any active cleanup is invoked.
 */
export declare function enqueueOrSupersede(chatId: string, dispatchId: string, callback: DispatchCallback, client: OpenGramClient, log?: {
    info(msg: string): void;
    warn(msg: string): void;
}): void;
/**
 * Register a cleanup function for an active dispatch. Called from inside the
 * dispatch callback after the streaming message and typing heartbeat are
 * created — so the queue can cancel them if a new message supersedes.
 */
export declare function setDispatchCleanup(chatId: string, dispatchId: string, cleanup: () => void): void;
/** Mark a dispatch as superseded so late deliver callbacks are no-oped. */
export declare function markSuperseded(dispatchId: string): void;
/** Check if a dispatch has been superseded. */
export declare function isSuperseded(dispatchId: string): boolean;
/** Get the active dispatch ID for a chat (for testing). */
export declare function getActiveDispatchId(chatId: string): string | undefined;
/** Clear all queues and state. Only for testing. */
export declare function clearChatQueuesForTests(): void;
