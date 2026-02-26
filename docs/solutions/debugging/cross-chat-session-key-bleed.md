---
title: "Cross-chat reply bleed: never trust route.sessionKey for per-chat isolation"
category: debugging
tags: [openclaw, session-key, routing, dmScope, cross-chat, critical-bug]
date: 2026-02-26
task: KAI-232
---

# Cross-Chat Reply Bleed: Session Key Isolation

## Problem

All chats with the same agent shared one agent session. Replies went to whichever chat last registered a stream — users received messages meant for other conversations.

## Root cause

OpenClaw's `resolveAgentRoute()` returns `route.sessionKey` based on `dmScope` config. The default `dmScope="main"` produces a **shared** key:

```
buildAgentPeerSessionKey(dmScope="main") → buildAgentMainSessionKey() → "agent:<agentId>:main"
```

The plugin's `buildSessionKey()` used a regex (`AGENT_SESSION_KEY_RE = /^agent:[^:]+:(.+)$/i`) to extract the suffix from `route.sessionKey` and build a session key from it — **dropping the chatId entirely**:

```ts
// BEFORE (broken) — all chats got "agent:grami:main"
const routeMatch = route.sessionKey.match(AGENT_SESSION_KEY_RE);
if (routeMatch) {
  return `agent:${normalizedAgentId}:${routeMatch[1]}`;  // "main" — no chatId!
}
```

## Fix

Ignore `route.sessionKey` completely. Always build per-chat keys:

```ts
function buildSessionKey(chatId: string, agentId: string): string {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) throw new Error("[opengram] Cannot dispatch inbound event without chatId");
  const normalizedAgentId = normalizeAgentIdForSessionKey(agentId);
  return `agent:${normalizedAgentId}:${CHANNEL_ID}:direct:${normalizedChatId.toLowerCase()}`;
}
```

Also removed the `routeSessionKey` parameter from `dispatchViaSdk()` since it's no longer used.

## Key insight

**OpenClaw's session routing model does not match OpenGram's per-chat isolation requirement.** OpenClaw was designed for channels like IRC/Discord where one "peer" might map to one user across conversations. OpenGram is different: every chat is an independent conversation with its own agent session, regardless of what `dmScope` says.

The fix is to have the plugin own its session key format entirely, using `route.sessionKey` only as documentation of what OpenClaw *would* do — never as an input.

## Defence-in-depth comment

A comment was added to `buildSessionKey` explaining why `route.sessionKey` is intentionally ignored, to prevent future regressions:

```ts
/**
 * Build a per-chat session key. We intentionally ignore route.sessionKey from
 * OpenClaw's resolveAgentRoute because OpenGram requires per-chat session
 * isolation — a shared session key (e.g. dmScope="main" → "agent:id:main")
 * would route all chats into one agent session, causing cross-chat reply bleed.
 * See KAI-232.
 */
```

## Test strategy

Three focused tests in `cross-chat-session-key.test.ts`:

1. **Two chats → different session keys**: Send messages from `chat-alpha` and `chat-beta`, verify `SessionKey` values passed to `finalizeInboundContext` differ
2. **Session key contains chatId**: Verify the key isn't the shared `"agent:main:main"`
3. **dmScope doesn't collapse keys**: Three chats, verify all three session keys are unique

The mock runtime simulates `dmScope="main"` by having `resolveAgentRouteSpy` return `{ sessionKey: "agent:main:main" }` — reproducing the exact production default.

## Checklist for future channel plugins

- [ ] Does your plugin use `route.sessionKey` directly? If so, verify it produces unique keys per conversation
- [ ] Does the default `dmScope` setting produce shared keys? Test with 2+ conversations
- [ ] Add a regression test: same agent, different conversations → different session keys
