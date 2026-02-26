---
title: "Per-chat dispatch queue with supersede pattern"
category: architecture
tags: [openclaw, dispatch, streaming, supersede, chat-queue, concurrency]
date: 2026-02-26
task: KAI-230
---

# Per-Chat Dispatch Queue with Supersede Pattern

## Problem

When a user sends multiple messages rapidly to the same chat, each triggers an independent agent dispatch. The previous dispatch's streaming message and typing indicator become orphaned — the UI shows stale typing bubbles and partial replies that never complete.

## Solution: `chat-queue.ts` — enqueueOrSupersede

A per-chat dispatch queue tracks the latest dispatch per chat. When a new message arrives, the previous dispatch is "superseded":

1. Its deliver callbacks become **no-ops** (via `isSuperseded(dispatchId)` check)
2. Its streaming messages are **cancelled** (plugin-side via `cancelAllStreamsForChat`, server-side via bulk `POST /cancel-streaming`)
3. Its typing heartbeat is **stopped** (via cleanup callback)

```ts
// chat-queue.ts core API
enqueueOrSupersede(chatId, dispatchId, callback, client, log)
setDispatchCleanup(chatId, dispatchId, cleanup)
isSuperseded(dispatchId)  // checked before every deliver call
```

## Key design decisions

### Why not a real queue (FIFO)?

Agent dispatches are long-running (seconds to minutes). Queuing would make the user wait for stale replies to finish before their latest message gets processed. Supersede is the right model: only the latest message matters.

### Why track superseded dispatches in a Set with TTL?

The SDK's `dispatchReplyWithBufferedBlockDispatcher` may call `deliver` **after** the dispatch Promise resolves (late delivery). The superseded Set persists for 5 minutes so late callbacks are still no-oped:

```ts
const SUPERSEDE_TTL_MS = 5 * 60 * 1000;

export function markSuperseded(dispatchId: string): void {
  supersededDispatches.add(dispatchId);
  setTimeout(() => supersededDispatches.delete(dispatchId), SUPERSEDE_TTL_MS);
}
```

### Why cancel both plugin-side and server-side streams?

- `cancelAllStreamsForChat(client, chatId)` — cancels the plugin's in-memory stream tracking and individual message cancellation
- `client.cancelStreamingMessagesForChat(chatId)` — bulk SQL `UPDATE ... SET stream_state='cancelled'` as a safety net for any streams the plugin doesn't know about

### Why separate `latestDispatches` from `activeCleanups`?

`latestDispatches` persists after a dispatch completes (needed for late-delivery detection). `activeCleanups` is cleared when the dispatch finishes (cleanup is only meaningful while the dispatch is running).

### Why use a monotonic counter for dispatchId instead of Date.now()?

`Date.now()` can produce duplicate IDs if two messages for the same chat arrive within the same millisecond, causing the second dispatch to supersede itself. A module-level `++dispatchSeq` counter guarantees uniqueness within the process:

```ts
let dispatchSeq = 0;
const dispatchId = `${chatId}:${++dispatchSeq}`;
```

### Why add a stuck-dispatch watchdog timer?

If an SDK dispatch hangs indefinitely and no new message supersedes it, the `activeCleanups` and `latestDispatches` entries persist forever. A 5-minute watchdog timer force-cleans stuck dispatches:

```ts
const watchdog = setTimeout(() => {
  // force-clean: call cleanup, delete from activeCleanups + latestDispatches
}, STUCK_DISPATCH_TIMEOUT_MS);
```

The timer is cleared on normal completion (`finishDispatch`) and on supersede (replaced by the new dispatch's watchdog).

## Server-side bulk cancel endpoint

```
POST /api/v1/chats/:chatId/messages/cancel-streaming
→ { cancelledMessageIds: string[] }
```

Cancels all `stream_state='streaming'` messages for the chat in a single transaction, emits `message.streaming.complete` events for each.

## Testing approach

Tests use the `dispatch` injection pattern (not the SDK) and manually control when `deliver` is called:

```ts
const dispatches: Array<{ deliver: ..., onCleanup: ... }> = [];
const dispatch: DispatchFn = ({ deliver, onCleanup }) => {
  dispatches.push({ deliver, onCleanup });
};
```

This allows testing supersede by:
1. Trigger message 1 → captured in dispatches[0]
2. Deliver a partial block from dispatches[0]
3. Trigger message 2 → dispatches[0] is superseded
4. Verify late deliver from dispatches[0] is a no-op
5. Verify dispatches[1] delivers normally
