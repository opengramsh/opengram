import type Database from 'better-sqlite3';
import { createHmac } from 'node:crypto';
import { nanoid } from 'nanoid';

import type { HookConfig } from '@/src/config/opengram-config';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import { getDb } from '@/src/db/client';
import type { EventEnvelope } from '@/src/services/events-service';
import { subscribeToEvents } from '@/src/services/events-service';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 30_000;
const RETENTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const IDEMPOTENCY_KEY_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

const CONFIG_CACHE_TTL_MS = 5000; // Re-read config at most every 5 seconds

const HOOKS_SUBSCRIBER_GLOBAL_KEY = '__opengramHooksSubscriber';
const RETENTION_CLEANUP_GLOBAL_KEY = '__opengramRetentionCleanup';

function computeBackoffMs(attempt: number) {
  return Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, MAX_BACKOFF_MS);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function signPayload(body: string, secret: string) {
  const hmac = createHmac('sha256', secret);
  hmac.update(body);
  return `sha256=${hmac.digest('hex')}`;
}

function buildEnrichedPayload(envelope: EventEnvelope): Record<string, unknown> {
  const { type, payload } = envelope;

  if (type === 'message.created') {
    const chatId = payload.chatId as string | undefined;
    const messageId = payload.messageId as string | undefined;
    if (chatId && messageId) {
      try {
        const db = getDb();
        const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as Record<string, unknown> | undefined;
        const chat = db.prepare('SELECT id, agent_ids, model_id, pending_requests_count FROM chats WHERE id = ?').get(chatId) as Record<string, unknown> | undefined;

        if (!message || !chat) {
          return payload;
        }

        return {
          chatId,
          agentIds: parseJsonArray(chat.agent_ids as string | null),
          messageId: message.id,
          senderId: message.sender_id,
          role: message.role,
          content: message.content_final ?? message.content_partial,
          modelId: message.model_id,
          pendingRequestsCount: chat.pending_requests_count,
          trace: parseJsonOrNull(message.trace as string | null),
        };
      } catch {
        return payload;
      }
    }
  }

  if (type === 'request.resolved' || type === 'request.cancelled') {
    const requestId = payload.requestId as string | undefined;
    const chatId = payload.chatId as string | undefined;
    if (requestId && chatId) {
      try {
        const db = getDb();
        const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId) as Record<string, unknown> | undefined;

        if (!request) {
          return payload;
        }

        return {
          chatId,
          requestId: request.id,
          type: request.type,
          status: request.status,
          resolutionPayload: parseJsonOrNull(request.resolution_payload as string | null),
          trace: parseJsonOrNull(request.trace as string | null),
        };
      } catch {
        return payload;
      }
    }
  }

  return payload;
}

function parseJsonArray(value: string | null): unknown[] {
  if (value === null) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonOrNull(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function logDeliveryAttempt(
  eventId: string,
  targetUrl: string,
  statusCode: number | null,
  success: boolean,
  error: string | null,
) {
  try {
    const db = getDb();
    db.prepare(
      [
        'INSERT INTO webhook_deliveries (id, event_id, target_url, status_code, success, error, attempted_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(nanoid(), eventId, targetUrl, statusCode, success ? 1 : 0, error, Date.now());
  } catch {
    // Best-effort logging — never propagate failures.
  }
}

async function deliverHook(
  envelope: EventEnvelope,
  hook: HookConfig,
  enrichedPayload: Record<string, unknown>,
) {
  const body = JSON.stringify({
    id: envelope.id,
    type: envelope.type,
    timestamp: envelope.timestamp,
    payload: enrichedPayload,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(hook.headers ?? {}),
  };

  if (hook.signingSecret) {
    headers['X-OpenGram-Signature'] = signPayload(body, hook.signingSecret);
  }

  const timeoutMs = hook.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = hook.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(computeBackoffMs(attempt - 1));
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // SECURITY: Hook URLs come from the admin-controlled opengram.config.json,
      // not user input, so SSRF validation is not applied here. Ensure hook URLs
      // point to trusted external endpoints only.
      const response = await fetch(hook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const success = response.ok;
      logDeliveryAttempt(envelope.id, hook.url, response.status, success, success ? null : `HTTP ${response.status}`);

      if (success) {
        return;
      }

      // Non-retryable status codes
      if (response.status >= 400 && response.status < 500) {
        return;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logDeliveryAttempt(envelope.id, hook.url, null, false, errorMessage);
    }
  }
}

function matchesHook(hook: HookConfig, eventType: string) {
  return hook.events.includes(eventType);
}

let cachedConfig: { config: ReturnType<typeof loadOpengramConfig>; loadedAt: number } | null = null;

function getCachedConfig() {
  const now = Date.now();
  if (cachedConfig && now - cachedConfig.loadedAt < CONFIG_CACHE_TTL_MS) {
    return cachedConfig.config;
  }
  const config = loadOpengramConfig();
  cachedConfig = { config, loadedAt: now };
  return config;
}

function handleEvent(envelope: EventEnvelope) {
  const config = getCachedConfig();
  const hooks = config.hooks;

  if (hooks.length === 0) {
    return;
  }

  const matchingHooks = hooks.filter((hook) => matchesHook(hook, envelope.type));

  if (matchingHooks.length === 0) {
    return;
  }

  // Fire-and-forget: never block the event system.
  void (async () => {
    const enrichedPayload = buildEnrichedPayload(envelope);

    await Promise.allSettled(
      matchingHooks.map((hook) => deliverHook(envelope, hook, enrichedPayload)),
    );
  })();
}

export function startHooksSubscriber() {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  const scopedGlobal = globalThis as typeof globalThis & {
    [HOOKS_SUBSCRIBER_GLOBAL_KEY]?: boolean;
  };

  if (scopedGlobal[HOOKS_SUBSCRIBER_GLOBAL_KEY]) {
    return false;
  }

  subscribeToEvents(false, handleEvent);
  scopedGlobal[HOOKS_SUBSCRIBER_GLOBAL_KEY] = true;
  return true;
}

export function runRetentionCleanup() {
  const now = Date.now();

  const db = getDb();
  // Webhook deliveries are CASCADE-deleted when their parent event is deleted.
  db.prepare('DELETE FROM events WHERE created_at < ?').run(now - EVENT_RETENTION_MS);
  db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(now - IDEMPOTENCY_KEY_RETENTION_MS);
}

export function startRetentionCleanupJob() {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  const scopedGlobal = globalThis as typeof globalThis & {
    [RETENTION_CLEANUP_GLOBAL_KEY]?: ReturnType<typeof setInterval>;
  };

  if (scopedGlobal[RETENTION_CLEANUP_GLOBAL_KEY]) {
    return false;
  }

  const interval = setInterval(() => {
    try {
      runRetentionCleanup();
    } catch {
      // Keep the interval alive even if one cleanup iteration fails.
    }
  }, RETENTION_CLEANUP_INTERVAL_MS);

  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  scopedGlobal[RETENTION_CLEANUP_GLOBAL_KEY] = interval;
  return true;
}

// ── Test helpers ──────────────────────────────────────────────────────

export function resetHooksServiceForTests() {
  cachedConfig = null;

  const scopedGlobal = globalThis as typeof globalThis & {
    [HOOKS_SUBSCRIBER_GLOBAL_KEY]?: boolean;
    [RETENTION_CLEANUP_GLOBAL_KEY]?: ReturnType<typeof setInterval>;
  };

  delete scopedGlobal[HOOKS_SUBSCRIBER_GLOBAL_KEY];

  if (scopedGlobal[RETENTION_CLEANUP_GLOBAL_KEY]) {
    clearInterval(scopedGlobal[RETENTION_CLEANUP_GLOBAL_KEY]);
    delete scopedGlobal[RETENTION_CLEANUP_GLOBAL_KEY];
  }
}

/**
 * Directly invoke the event handler for testing without the subscriber system.
 * Processes the hook synchronously to allow test assertions.
 */
export async function processEventForTests(envelope: EventEnvelope) {
  const config = loadOpengramConfig();
  const hooks = config.hooks;
  const matchingHooks = hooks.filter((hook) => matchesHook(hook, envelope.type));
  const enrichedPayload = buildEnrichedPayload(envelope);

  for (const hook of matchingHooks) {
    await deliverHook(envelope, hook, enrichedPayload);
  }
}

export { buildEnrichedPayload as buildEnrichedPayloadForTests };
export { matchesHook as matchesHookForTests };
