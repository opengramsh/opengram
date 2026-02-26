---
title: "Post-await supersede check for async resource creation"
category: architecture
tags: [openclaw, dispatch, race-condition, async, supersede, streaming, TOCTOU]
date: 2026-02-26
task: KAI-234
---

# Post-Await Supersede Check for Async Resource Creation

## Problem

The per-chat dispatch queue (KAI-230) supersedes previous dispatches synchronously when a new message arrives. The supersede handler cancels active streams and streaming messages. But there's a TOCTOU (time-of-check-time-of-use) gap:

```
Timeline (6 rapid messages for the same chat):

  t0: enqueueOrSupersede(msg1) — no streams exist yet
  t1: enqueueOrSupersede(msg2) — supersedes msg1, but msg1 has no streams to cancel
  t2: enqueueOrSupersede(msg3) — supersedes msg2, same issue
  ...
  t5: enqueueOrSupersede(msg6) — supersedes msg5

  t6: All 6 dispatch callbacks start concurrently
  t7: All 6 call `await client.createMessage(chatId, { streaming: true })`
  t8: All 6 HTTP responses return — 6 streaming messages now exist on the server
  t9: Only msg6 proceeds; msgs 1-5 were superseded but their streaming messages
      are ORPHANED because the supersede happened BEFORE createMessage returned
```

The supersede cleanup ran at t1-t5, but the streaming messages were created at t7-t8. The cleanup can't cancel resources that don't exist yet.

## Solution: Re-check after every async resource creation

After any `await` that creates a cancellable resource, re-check `isSuperseded(dispatchId)`. If true, cancel the just-created resource and return early:

```ts
const streamingMsg = await client.createMessage(chatId, {
  role: "agent",
  senderId: agentId,
  streaming: true,
});

// KAI-234: Re-check after the await gap
if (isSuperseded(dispatchId)) {
  await client.cancelMessage(streamingMsg.id).catch(() => {});
  return;
}

initStream(dispatchId, chatId, streamingMsg.id, agentId);
```

## Key details

### Why `.catch(() => {})` on the cancel?

The server may have already cleaned up the streaming message (e.g., stale-streaming sweeper, or the bulk `cancelStreamingMessagesForChat` call from the supersede handler). A 404/409 is expected and harmless.

### Why cancel the specific message, not bulk cancel?

At this point, the new (latest) dispatch may have already created its own streaming message. Bulk `cancelStreamingMessagesForChat` would cancel that too. Targeting the specific orphaned `streamingMsg.id` is safer.

### Where does this check go?

Both dispatch paths need it:
- `handleMessageCreated` — user sends a message
- `handleRequestResolved` — user resolves a request (choice, form, text input)

The check goes after `createMessage` and before `initStream`, which seeds the streaming state map.

## General pattern

This is a general pattern for any dispatch/queue system with async callbacks:

```
1. Queue/supersede logic runs synchronously
2. Callback runs async — creates resources via network calls
3. Between steps 1 and 2, the dispatch may have been superseded
4. After each await that creates a cancellable resource, re-check the supersede flag
5. If superseded: cancel the just-created resource, return early
```

The pattern applies whenever:
- Cancellation is synchronous but resource creation is async
- Multiple callbacks can be in-flight concurrently
- Resources are cancellable but only after they exist

## Related

- [Per-chat dispatch queue (KAI-230)](./per-chat-dispatch-queue-supersede.md)
- [Cross-chat session key bleed (KAI-232)](../debugging/cross-chat-session-key-bleed.md)
