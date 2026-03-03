import type Database from 'better-sqlite3';
import { isIP } from 'node:net';
import { nanoid } from 'nanoid';

import { internalError, validationError } from '@/src/api/http';
import { loadOpengramConfig } from '@/src/config/opengram-config';
import { getDb } from '@/src/db/client';
import { sendWebPushNotification } from '@/src/services/push-crypto';

type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

type PushSubscriptionInput = {
  endpoint: unknown;
  keys: unknown;
};

type PushNotificationPayload = {
  title: string;
  body: string;
  data: {
    chatId: string;
    messageId?: string;
    type: 'message' | 'request' | 'test';
    url: string;
  };
};

type PushSubscriptionRecord = {
  id: string;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
  user_agent: string | null;
  created_at: number;
};

type WebPushSubscription = {
  endpoint: string;
  keys: PushSubscriptionKeys;
};

const MAX_BODY_CHARS = 240;
const MAX_PAYLOAD_BYTES = 4000;
const ALLOWED_PUSH_EXACT_HOSTS = ['fcm.googleapis.com'];
const ALLOWED_PUSH_SUFFIX_HOSTS = ['.push.apple.com', '.push.services.mozilla.com'];

function isAllowedPushEndpointHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (ALLOWED_PUSH_EXACT_HOSTS.includes(normalized)) {
    return true;
  }

  for (const suffix of ALLOWED_PUSH_SUFFIX_HOSTS) {
    if (normalized === suffix.slice(1) || normalized.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

function isDisallowedHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }

  if (normalized.endsWith('.local') || normalized.endsWith('.internal')) {
    return true;
  }

  if (!normalized.includes('.')) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 0) {
    return false;
  }

  if (ipVersion === 4) {
    const segments = normalized.split('.').map((part) => Number.parseInt(part, 10));
    if (segments.length !== 4 || segments.some((segment) => Number.isNaN(segment) || segment < 0 || segment > 255)) {
      return true;
    }

    const [a, b] = segments;
    if (
      a === 10
      || a === 127
      || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }

    return false;
  }

  const lower = normalized.toLowerCase();
  if (
    lower === '::'
    || lower === '::1'
    || lower.startsWith('fc')
    || lower.startsWith('fd')
    || lower.startsWith('fe8')
    || lower.startsWith('fe9')
    || lower.startsWith('fea')
    || lower.startsWith('feb')
  ) {
    return true;
  }

  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    return isDisallowedHost(mapped);
  }

  return false;
}

function normalizeSubscriptionEndpoint(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw validationError('endpoint is required.', { field: 'endpoint' });
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw validationError('endpoint must be a valid URL.', { field: 'endpoint' });
  }

  if (parsed.protocol !== 'https:') {
    throw validationError('endpoint must use HTTPS.', { field: 'endpoint' });
  }

  if (isDisallowedHost(parsed.hostname)) {
    throw validationError('endpoint host is not allowed.', { field: 'endpoint' });
  }

  if (!isAllowedPushEndpointHost(parsed.hostname)) {
    throw validationError('endpoint host must be a supported Web Push provider.', { field: 'endpoint' });
  }

  return parsed.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requirePushEnabled() {
  const config = loadOpengramConfig();
  if (!config.push.enabled) {
    throw validationError('Push notifications are disabled in config.');
  }

  return config;
}

function getVapidDetails() {
  const config = requirePushEnabled();
  return {
    subject: config.push.subject,
    publicKey: config.push.vapidPublicKey,
    privateKey: config.push.vapidPrivateKey,
  };
}

function parseSubscriptionKeys(value: unknown): PushSubscriptionKeys {
  if (!isRecord(value)) {
    throw validationError('keys must be an object with p256dh and auth.', { field: 'keys' });
  }

  const p256dh = value.p256dh;
  const auth = value.auth;

  if (typeof p256dh !== 'string' || !p256dh.trim()) {
    throw validationError('keys.p256dh is required.', { field: 'keys.p256dh' });
  }

  if (typeof auth !== 'string' || !auth.trim()) {
    throw validationError('keys.auth is required.', { field: 'keys.auth' });
  }

  return {
    p256dh: p256dh.trim(),
    auth: auth.trim(),
  };
}

function normalizeSubscription(input: PushSubscriptionInput): WebPushSubscription {
  return {
    endpoint: normalizeSubscriptionEndpoint(input.endpoint),
    keys: parseSubscriptionKeys(input.keys),
  };
}

function normalizeEndpoint(endpoint: unknown) {
  return normalizeSubscriptionEndpoint(endpoint);
}

function normalizeBodyPreview(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Open chat to view the latest update.';
  }

  if (trimmed.length <= MAX_BODY_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_BODY_CHARS - 1).trimEnd()}…`;
}

function resolveNotificationUrl(chatId: string, url: unknown) {
  const normalizedChatId = chatId.trim();
  const chatPath = normalizedChatId ? `/chats/${encodeURIComponent(normalizedChatId)}` : '/';
  if (typeof url !== 'string' || !url.trim()) {
    return chatPath;
  }

  try {
    const base = new URL('https://app.local');
    const parsed = new URL(url, base);
    if (parsed.origin !== base.origin) {
      return chatPath;
    }
    const pathname = parsed.pathname && parsed.pathname.startsWith('/') ? parsed.pathname : '/';
    return `${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return chatPath;
  }
}

function buildPayload(payload: PushNotificationPayload) {
  const compact = {
    title: payload.title,
    body: normalizeBodyPreview(payload.body),
    data: payload.data,
  };

  let encoded = JSON.stringify(compact);
  while (Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES && compact.body.length > 0) {
    const sliced = compact.body.slice(0, Math.max(0, compact.body.length - 16)).trimEnd();
    const nextBody = sliced ? `${sliced}…` : '';
    if (nextBody === compact.body) {
      break;
    }
    compact.body = nextBody;
    encoded = JSON.stringify(compact);
  }

  if (Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw internalError('Push payload exceeds allowed size.');
  }

  return encoded;
}

function toWebPushSubscription(record: PushSubscriptionRecord): WebPushSubscription {
  return {
    endpoint: record.endpoint,
    keys: {
      p256dh: record.keys_p256dh,
      auth: record.keys_auth,
    },
  };
}

function listSubscriptions(db: Database.Database) {
  return db.prepare('SELECT * FROM push_subscriptions ORDER BY created_at DESC').all() as PushSubscriptionRecord[];
}

function removeSubscriptionByEndpoint(db: Database.Database, endpoint: string) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

async function sendPayloadToAll(payload: PushNotificationPayload) {
  const config = loadOpengramConfig();
  if (!config.push.enabled) {
    return { sent: 0, failed: 0, removed: 0 };
  }

  const vapid = getVapidDetails();
  const encodedPayload = buildPayload(payload);
  const db = getDb();
  const subscriptions = listSubscriptions(db);

  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const record of subscriptions) {
    try {
      await sendWebPushNotification(toWebPushSubscription(record), encodedPayload, vapid);
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : null;
      if (statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 410) {
        const dbInner = getDb();
        removeSubscriptionByEndpoint(dbInner, record.endpoint);
        removed += 1;
      } else {
        const host = new URL(record.endpoint).host;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[push] delivery failed for ${host} (status ${statusCode ?? 'unknown'}): ${message}`);
      }
    }
  }

  return { sent, failed, removed };
}

function resolveAgentNameById(agentId: string | null) {
  const config = loadOpengramConfig();
  if (!agentId) {
    return config.appName;
  }

  const agent = config.agents.find((candidate) => candidate.id === agentId);
  return agent?.name ?? config.appName;
}

function resolvePrimaryAgentForChat(chatId: string) {
  const db = getDb();
  const row = db.prepare('SELECT agent_ids FROM chats WHERE id = ?').get(chatId) as { agent_ids: string } | undefined;
  if (!row) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.agent_ids) as unknown;
    if (Array.isArray(parsed)) {
      const first = parsed.find((value) => typeof value === 'string');
      return typeof first === 'string' ? first : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function upsertPushSubscription(input: PushSubscriptionInput, userAgent: string | null = null) {
  requirePushEnabled();
  const subscription = normalizeSubscription(input);

  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?')
    .get(subscription.endpoint) as { id: string } | undefined;

  const now = Date.now();
  if (existing) {
    db.prepare(
      [
        'UPDATE push_subscriptions',
        'SET keys_p256dh = ?, keys_auth = ?, user_agent = ?, created_at = ?',
        'WHERE endpoint = ?',
      ].join(' '),
    ).run(subscription.keys.p256dh, subscription.keys.auth, userAgent, now, subscription.endpoint);

    return {
      id: existing.id,
      endpoint: subscription.endpoint,
    };
  }

  const id = nanoid();
  db.prepare(
    [
      'INSERT INTO push_subscriptions (id, endpoint, keys_p256dh, keys_auth, user_agent, created_at)',
      'VALUES (?, ?, ?, ?, ?, ?)',
    ].join(' '),
  ).run(id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent, now);

  return {
    id,
    endpoint: subscription.endpoint,
  };
}

export function deletePushSubscription(endpoint: unknown) {
  requirePushEnabled();
  const normalizedEndpoint = normalizeEndpoint(endpoint);

  const db = getDb();
  const result = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(normalizedEndpoint);
  return result.changes > 0;
}

export async function sendTestPushNotification(input: {
  title?: unknown;
  body?: unknown;
  chatId?: unknown;
  url?: unknown;
} = {}) {
  requirePushEnabled();

  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : 'OpenGram';
  const body = typeof input.body === 'string' && input.body.trim()
    ? input.body.trim()
    : 'This is a test push notification.';
  const chatId = typeof input.chatId === 'string' && input.chatId.trim() ? input.chatId.trim() : 'test';
  const url = resolveNotificationUrl(chatId, input.url);

  return sendPayloadToAll({
    title,
    body,
    data: {
      chatId,
      type: 'test',
      url,
    },
  });
}

export async function notifyAgentMessageCreated(input: {
  chatId: string;
  messageId: string;
  senderId: string;
  preview: string | null;
}) {
  const config = loadOpengramConfig();
  if (!config.push.enabled) {
    return;
  }

  const title = resolveAgentNameById(input.senderId);
  const body = input.preview ?? 'New message received.';

  await sendPayloadToAll({
    title,
    body,
    data: {
      chatId: input.chatId,
      messageId: input.messageId,
      type: 'message',
      url: resolveNotificationUrl(input.chatId, `/chats/${input.chatId}`),
    },
  });
}

export async function notifyRequestCreated(input: {
  chatId: string;
  title: string;
}) {
  const config = loadOpengramConfig();
  if (!config.push.enabled) {
    return;
  }

  const primaryAgentId = resolvePrimaryAgentForChat(input.chatId);

  await sendPayloadToAll({
    title: resolveAgentNameById(primaryAgentId),
    body: input.title,
    data: {
      chatId: input.chatId,
      type: 'request',
      url: resolveNotificationUrl(input.chatId, `/chats/${input.chatId}`),
    },
  });
}

export function resetPushServiceForTests() {
  // No-op: VAPID details are now read fresh from config on each send.
}
