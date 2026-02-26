import type { OpenGramClient } from "./api-client.js";
import { cancelAllStreamsForChat } from "./streaming.js";

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

type ActiveCleanup = {
  dispatchId: string;
  cleanup: () => void;
};

/**
 * Tracks the latest (most recent) dispatch per chat. Used to mark the
 * previous dispatch as superseded even if its callback already finished.
 */
const latestDispatches = new Map<string, string>();

/**
 * Tracks the cleanup function for the currently in-flight dispatch per chat.
 * This is only populated while the callback's Promise is pending.
 */
const activeCleanups = new Map<string, ActiveCleanup>();

const supersededDispatches = new Set<string>();

/** Watchdog timers that force-clean dispatches stuck longer than STUCK_DISPATCH_TIMEOUT_MS. */
const stuckTimers = new Map<string, ReturnType<typeof setTimeout>>();

const SUPERSEDE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STUCK_DISPATCH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Enqueue a dispatch for a chat. If a previous dispatch exists for this
 * chat, it is superseded: its deliver callbacks become no-ops, its
 * streaming messages are cancelled, and any active cleanup is invoked.
 */
export function enqueueOrSupersede(
  chatId: string,
  dispatchId: string,
  callback: DispatchCallback,
  client: OpenGramClient,
  log?: { info(msg: string): void; warn(msg: string): void },
): void {
  const prevLatest = latestDispatches.get(chatId);

  if (prevLatest) {
    // Mark the previous dispatch as superseded. Even if its callback already
    // finished, the deliver closure may still be held by the caller (the SDK
    // can deliver late). The supersede flag makes those late calls no-op.
    log?.info(`[chat-queue] superseding dispatch ${prevLatest} for chat ${chatId}`);
    markSuperseded(prevLatest);

    // If the previous dispatch is still active, call its cleanup.
    const active = activeCleanups.get(chatId);
    if (active?.dispatchId === prevLatest) {
      active.cleanup();
      activeCleanups.delete(chatId);
    }

    // Cancel all plugin-side streams for this chat.
    cancelAllStreamsForChat(client, chatId);

    // Do not bulk-cancel server-side chat streams here.
    // That async request can race with the newly winning dispatch's eager
    // stream creation and cancel the winner's message.

    // Clear the previous dispatch's watchdog timer.
    const prevTimer = stuckTimers.get(chatId);
    if (prevTimer) {
      clearTimeout(prevTimer);
      stuckTimers.delete(chatId);
    }
  }

  // Set this as the latest and active dispatch.
  latestDispatches.set(chatId, dispatchId);
  activeCleanups.set(chatId, { dispatchId, cleanup: () => {} });

  // Watchdog: force-clean if the dispatch hangs longer than the timeout.
  const watchdog = setTimeout(() => {
    const active = activeCleanups.get(chatId);
    if (active?.dispatchId === dispatchId) {
      log?.warn(`[chat-queue] dispatch ${dispatchId} timed out after ${STUCK_DISPATCH_TIMEOUT_MS / 1000}s, force-cleaning`);
      active.cleanup();
      activeCleanups.delete(chatId);
      latestDispatches.delete(chatId);
    }
    stuckTimers.delete(chatId);
  }, STUCK_DISPATCH_TIMEOUT_MS);
  stuckTimers.set(chatId, watchdog);

  // Run the callback.
  callback(dispatchId).then(
    () => {
      finishDispatch(chatId, dispatchId);
    },
    (err) => {
      log?.warn(`[chat-queue] dispatch ${dispatchId} failed: ${String(err)}`);
      finishDispatch(chatId, dispatchId);
    },
  );
}

/**
 * Register a cleanup function for an active dispatch. Called from inside the
 * dispatch callback after the streaming message and typing heartbeat are
 * created — so the queue can cancel them if a new message supersedes.
 */
export function setDispatchCleanup(chatId: string, dispatchId: string, cleanup: () => void): void {
  const active = activeCleanups.get(chatId);
  if (active?.dispatchId === dispatchId) {
    active.cleanup = cleanup;
  }
}

function finishDispatch(chatId: string, dispatchId: string): void {
  const active = activeCleanups.get(chatId);
  if (active?.dispatchId === dispatchId) {
    activeCleanups.delete(chatId);
  }
  // Clear the stuck-dispatch watchdog since the dispatch completed.
  const timer = stuckTimers.get(chatId);
  if (timer) {
    clearTimeout(timer);
    stuckTimers.delete(chatId);
  }
  // latestDispatches is intentionally NOT cleared here — it's needed to detect
  // supersede even after a dispatch finishes (the deliver callback may still
  // be called late by the SDK).
}

/** Mark a dispatch as superseded so late deliver callbacks are no-oped. */
export function markSuperseded(dispatchId: string): void {
  supersededDispatches.add(dispatchId);
  // TTL-based cleanup to prevent unbounded growth
  setTimeout(() => {
    supersededDispatches.delete(dispatchId);
  }, SUPERSEDE_TTL_MS);
}

/** Check if a dispatch has been superseded. */
export function isSuperseded(dispatchId: string): boolean {
  return supersededDispatches.has(dispatchId);
}

/** Get the active dispatch ID for a chat (for testing). */
export function getActiveDispatchId(chatId: string): string | undefined {
  return activeCleanups.get(chatId)?.dispatchId;
}

/** Get the latest dispatch ID for a chat (for testing). */
export function getLatestDispatchId(chatId: string): string | undefined {
  return latestDispatches.get(chatId);
}

/** Clear all queues and state. Only for testing. */
export function clearChatQueuesForTests(): void {
  latestDispatches.clear();
  activeCleanups.clear();
  supersededDispatches.clear();
  for (const timer of stuckTimers.values()) clearTimeout(timer);
  stuckTimers.clear();
}
