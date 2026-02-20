---
title: Webhook delivery patterns — retry, signing, and async dispatch
category: architecture
tags: [webhooks, retry, backoff, hmac, async, fire-and-forget]
date: 2026-02-19
task: GRAM-020
---

# Webhook Delivery Patterns

## Exponential backoff with jitter

Deterministic retry timing (`1000 * 2^attempt`) causes thundering-herd behavior when multiple hooks target the same endpoint. Always add randomized jitter:

```ts
function computeBackoffMs(attempt: number) {
  return Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, MAX_BACKOFF_MS);
}
```

## Parallel delivery for independent hooks

When multiple hooks match the same event, deliver them in parallel with `Promise.allSettled` — not sequentially. A slow or failing hook should never delay others:

```ts
await Promise.allSettled(
  matchingHooks.map((hook) => deliverHook(envelope, hook, enrichedPayload)),
);
```

## Config caching for hot paths

Avoid re-reading config from disk on every event. Cache with a short TTL (e.g. 5s) so changes propagate quickly but disk I/O is bounded:

```ts
let cachedConfig: { config: Config; loadedAt: number } | null = null;

function getCachedConfig() {
  const now = Date.now();
  if (cachedConfig && now - cachedConfig.loadedAt < CONFIG_CACHE_TTL_MS) {
    return cachedConfig.config;
  }
  const config = loadConfig();
  cachedConfig = { config, loadedAt: now };
  return config;
}
```

Reset the cache in test helpers to ensure test isolation.

## SSRF considerations for admin-controlled URLs

Hook URLs sourced from admin-controlled config files (not user input) have low SSRF risk. Document this explicitly in code rather than adding runtime validation that would add complexity without meaningful security benefit. If URLs ever become user-configurable, add SSRF validation at that point.

## 4xx short-circuit

Never retry client errors (4xx) — they indicate a permanent problem (bad auth, wrong endpoint, payload rejected). Only retry 5xx and network errors.
