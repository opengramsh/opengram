import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';

import { loadOpengramConfig } from '@/src/config/opengram-config';
import { getDb } from '@/src/db/client';
import { startHooksSubscriber, startRetentionCleanupJob } from '@/src/services/hooks-service';
import { ensureStreamingTimeoutSweeperStarted } from '@/src/services/messages-service';

import chats from '@/src/routes/chats';
import configRouter from '@/src/routes/config';
import events from '@/src/routes/events';
import health from '@/src/routes/health';
import { chatMedia, files, mediaMetadata } from '@/src/routes/media';
import { chatMessages, messageActions } from '@/src/routes/messages';
import push from '@/src/routes/push';
import requests from '@/src/routes/requests';
import searchRouter from '@/src/routes/search';
import tags from '@/src/routes/tags';

let cachedCorsOriginsRaw: string | undefined;
let cachedCorsOrigins: string[] = [];

function getCorsOrigins(): string[] {
  const raw = process.env.OPENGRAM_CORS_ORIGINS;
  if (raw === cachedCorsOriginsRaw) {
    return cachedCorsOrigins;
  }

  cachedCorsOriginsRaw = raw;
  if (!raw || !raw.trim()) {
    cachedCorsOrigins = [];
    return cachedCorsOrigins;
  }

  cachedCorsOrigins = raw.split(',').map((o) => o.trim()).filter(Boolean);
  return cachedCorsOrigins;
}

export const app = new Hono();
const compressionMiddleware = compress();

// Global middleware
app.use(async (c, next) => {
  if (c.req.path === '/api/v1/events/stream') {
    await next();
    return;
  }

  return compressionMiddleware(c, next);
});
app.use('/api/*', cors({
  origin: (origin) => {
    const allowed = getCorsOrigins();
    if (!allowed.length) return origin;
    return allowed.includes(origin) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Instance-Secret'],
}));

// API routes
app.route('/api/v1/health', health);
app.route('/api/v1/config', configRouter);
app.route('/api/v1/chats', chats);
app.route('/api/v1/chats/:chatId/messages', chatMessages);
app.route('/api/v1/chats/:chatId/media', chatMedia);
app.route('/api/v1/messages', messageActions);
app.route('/api/v1/media', mediaMetadata);
app.route('/api/v1/files', files);
app.route('/api/v1/requests', requests);
app.route('/api/v1/search', searchRouter);
app.route('/api/v1/tags', tags);
app.route('/api/v1/events', events);
app.route('/api/v1/push', push);

// Static file serving (production): hashed assets with immutable cache
app.use('/assets/*', serveStatic({
  root: './dist/client',
  onFound: (_path, c) => {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));

// Static files (manifest, icons, sw.js, etc.)
app.use('/*', serveStatic({ root: './dist/client' }));

// SPA fallback: serve index.html for client-side routes
const spaFallback = serveStatic({ path: './dist/client/index.html' });
app.get('/*', async (c, next) => {
  if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
    return c.notFound();
  }
  return spaFallback(c, next);
});

// Start background jobs (replaces instrumentation-node.ts)
function startBackgroundJobs() {
  ensureStreamingTimeoutSweeperStarted();
  startHooksSubscriber();
  startRetentionCleanupJob();
}

// Server startup
if (process.env.NODE_ENV !== 'test') {
  // Initialize DB connection eagerly
  getDb();

  // Start background jobs
  startBackgroundJobs();

  const config = loadOpengramConfig();
  const port = config.server.port;

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`OpenGram server listening on http://localhost:${info.port}`);
  });
}

export { startBackgroundJobs };
