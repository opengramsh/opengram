---
title: OpenClaw SDK dispatch pattern for channel plugins
category: integration
tags: [openclaw, plugin-sdk, dispatch, PluginRuntime, inbound, agent-reply]
date: 2026-02-21
task: GRAM-056
---

# OpenClaw SDK Dispatch Pattern for Channel Plugins

## Problem

When building a new OpenClaw channel plugin (like OpenGram), inbound messages arrive via SSE but are silently dropped because the SDK dispatch call is missing. The agent never processes the message and never replies.

## Solution: `dispatchReplyWithBufferedBlockDispatcher` via `PluginRuntime`

Every channel plugin must call the SDK's buffered dispatcher to route inbound messages to the correct agent. The pattern has four parts:

### 1. Typed PluginRuntime singleton

```ts
// runtime.ts
import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setOpenGramRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getOpenGramRuntime(): PluginRuntime {
  if (!runtime) throw new Error("OpenGram runtime not initialized");
  return runtime;
}
```

The runtime is set during plugin registration (`register()`) and is guaranteed to be available before the gateway starts processing messages.

### 2. Session key via `resolveAgentRoute`

```ts
const route = core.channel.routing.resolveAgentRoute({
  cfg,
  channel: CHANNEL_ID,
  peer: { kind: "direct", id: chatId },
});
const sessionKey = route.sessionKey;
```

**Gotcha:** The plan called for `buildAgentPeerSessionKey()` but it's not re-exported from `openclaw/plugin-sdk`. Use `resolveAgentRoute()` instead — it returns the session key along with routing metadata.

### 3. Build MsgContext via `finalizeInboundContext`

```ts
const ctx = core.channel.reply.finalizeInboundContext({
  Body: content,
  RawBody: content,
  CommandBody: content,
  From: `${CHANNEL_ID}:${chatId}`,
  To: `${CHANNEL_ID}:${chatId}`,
  SessionKey: sessionKey,
  ChatType: "direct",
  Provider: CHANNEL_ID,
  Surface: CHANNEL_ID,
  MessageSid: messageId,
  OriginatingChannel: CHANNEL_ID,
  OriginatingTo: `${CHANNEL_ID}:${chatId}`,
  CommandAuthorized: true,
});
```

Key fields:
- `From` / `To` / `OriginatingTo`: use `channel:peerId` format
- `SessionKey`: from `resolveAgentRoute` — ensures 1 chat = 1 isolated session
- `CommandAuthorized: true`: allows agent commands (set to false for untrusted sources)

### 4. Dispatch with prefix options

```ts
const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
  cfg, agentId, channel: CHANNEL_ID,
});

await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
  ctx,
  cfg,
  dispatcherOptions: {
    ...prefixOptions,
    deliver: async (payload, info) => {
      await deliver(
        { text: payload.text, mediaUrl: payload.mediaUrl },
        { kind: info.kind },
      );
    },
    onError: (err, info) => { /* log and propagate */ },
  },
  replyOptions: { onModelSelected },
});
```

The `deliver` callback bridges SDK reply payloads to channel-specific delivery (streaming, final messages, media uploads, etc.).

## Test injection pattern

Keep the test-injectable `dispatch` parameter but add an `else` branch for production:

```ts
if (dispatch) {
  dispatch({ chatId, agentId, messageId, content, cfg, deliver, onCleanup, onError });
} else {
  await dispatchViaSdk({ chatId, agentId, messageId, content, cfg, deliver, onError, log });
}
```

This allows unit tests to inject mocks without touching the production path, while ensuring real SDK dispatch happens when no mock is provided.

## Testing the production path

Mock the `PluginRuntime` singleton with spies on `resolveAgentRoute`, `finalizeInboundContext`, and `dispatchReplyWithBufferedBlockDispatcher`. Simulate agent replies by calling the `deliver` callback inside the dispatch mock:

```ts
const dispatchSpy = vi.fn().mockImplementation(async (params) => {
  await params.dispatcherOptions.deliver(
    { text: "Agent reply" },
    { kind: "final" },
  );
});
```

This verifies end-to-end: SSE event → MsgContext construction → SDK dispatch → deliver callback → channel message creation.

## Reference implementations

- **IRC extension**: The most minimal reference (no accounts, no groups)
- **Discord extension**: Full-featured reference with accounts, guilds, threading, media
- Both use the same `getXxxRuntime()` singleton pattern
