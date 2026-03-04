import { readFileSync } from "node:fs";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "@/src/api/schemas/common";
import { apiReference } from "@scalar/hono-api-reference";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import pkg from "@/package.json";
import { ApiError } from "@/src/api/http";
import { ensurePushProvisioned, loadOpengramConfig } from "@/src/config/opengram-config";
import { getDb } from "@/src/db/client";
import dispatch from "@/src/routes/dispatch";
import {
  startDispatchBatchScheduler,
  startDispatchLeaseSweeper,
} from "@/src/services/dispatch-service";
import {
  startHooksSubscriber,
  startRetentionCleanupJob,
} from "@/src/services/hooks-service";
import { ensureStreamingTimeoutSweeperStarted } from "@/src/services/messages-service";

import chats from "@/src/routes/chats";
import configRouter from "@/src/routes/config";
import events from "@/src/routes/events";
import health from "@/src/routes/health";
import { chatMedia, files, mediaMetadata } from "@/src/routes/media";
import { chatMessages, messageActions } from "@/src/routes/messages";
import push from "@/src/routes/push";
import requests from "@/src/routes/requests";
import searchRouter from "@/src/routes/search";
import tags from "@/src/routes/tags";

function getCorsOrigins(): string[] {
  return loadOpengramConfig().server.corsOrigins;
}

export const app = new OpenAPIHono({
  defaultHook: validationHook,
});
const compressionMiddleware = compress();

// Global error handler — replaces try/catch in every route handler
app.onError((err, c) => {
  if (err instanceof ApiError) {
    const body = { error: { code: err.code, message: err.message, details: err.details } };
    return Response.json(body, { status: err.status, headers: err.headers });
  }
  if (err instanceof HTTPException) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: err.message } },
      err.status,
    );
  }
  console.error('Unhandled error:', err);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } },
    500,
  );
});

// Global middleware
app.use(async (c, next) => {
  if (c.req.path === "/api/v1/events/stream") {
    await next();
    return;
  }

  return compressionMiddleware(c, next);
});
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      const allowed = getCorsOrigins();
      if (!allowed.length) return origin;
      return allowed.includes(origin) ? origin : "";
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-Instance-Secret",
    ],
  }),
);

// API routes
app.route("/api/v1/health", health);
app.route("/api/v1/config", configRouter);
app.route("/api/v1/chats", chats);
app.route("/api/v1/chats/:chatId/messages", chatMessages);
app.route("/api/v1/chats/:chatId/media", chatMedia);
app.route("/api/v1/messages", messageActions);
app.route("/api/v1/media", mediaMetadata);
app.route("/api/v1/files", files);
app.route("/api/v1/requests", requests);
app.route("/api/v1/search", searchRouter);
app.route("/api/v1/tags", tags);
app.route("/api/v1/events", events);
app.route("/api/v1/push", push);
app.route("/api/v1/dispatch", dispatch);

// OpenAPI security scheme
app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Instance secret token',
});

// OpenAPI spec + docs
app.doc31('/api/v1/doc', {
  openapi: '3.1.0',
  info: {
    title: 'Opengram API',
    version: pkg.version,
    description: 'API for the Opengram messaging platform.',
  },
  servers: [
    { url: '/', description: 'Current instance root' },
  ],
  tags: [
    { name: 'Chats', description: 'Chat lifecycle management' },
    { name: 'Messages', description: 'Message creation, streaming, and listing' },
    { name: 'Media', description: 'Media upload, metadata, and listing' },
    { name: 'Files', description: 'File and thumbnail downloads' },
    { name: 'Requests', description: 'Interactive request management (choices, forms)' },
    { name: 'Dispatch', description: 'Agent dispatch batch claiming and lifecycle' },
    { name: 'Events', description: 'Server-sent event streaming' },
    { name: 'Config', description: 'Instance configuration' },
    { name: 'Push', description: 'Web push notification subscriptions' },
    { name: 'Search', description: 'Full-text search across chats and messages' },
    { name: 'Tags', description: 'Tag suggestions' },
    { name: 'Health', description: 'Health check' },
  ],
});

app.get('/api/v1/reference', apiReference({
  url: '/api/v1/doc',
  theme: 'kepler',
}));

// Static file serving (production): hashed assets with immutable cache
app.use(
  "/assets/*",
  serveStatic({
    root: "./dist/client",
    onFound: (_path, c) => {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    },
  }),
);

// Service worker: must never be cached to ensure updates propagate
app.use(
  "/sw.js",
  serveStatic({
    root: "./dist/client",
    onFound: (_path, c) => {
      c.header("Cache-Control", "no-cache, must-revalidate");
    },
  }),
);

// Static files (manifest, icons, etc.)
app.use(
  "/*",
  serveStatic({
    root: "./dist/client",
    // Always render app entry HTML via SPA fallback so bootstrap secrets are
    // injected at request time and never stale per-client.
    rewriteRequestPath: (requestPath) =>
      requestPath === "/" || requestPath === "/index.html"
        ? "/__opengram_spa_entry__.html"
        : requestPath,
  }),
);

// SPA fallback: serve index.html with bootstrap injection
let spaHtmlTemplate: string | null = null;

function getSpaHtml(): string {
  if (!spaHtmlTemplate) {
    spaHtmlTemplate = readFileSync("./dist/client/index.html", "utf8");
  }
  return spaHtmlTemplate;
}

app.get("/*", (c) => {
  if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
    return c.notFound();
  }
  const cfg = loadOpengramConfig();
  const bootstrap = {
    instanceSecret: cfg.security.instanceSecretEnabled ? cfg.security.instanceSecret : null,
  };
  const json = JSON.stringify(bootstrap).replace(/<\//g, "<\\/");
  const script = `<script>window.__OPENGRAM_BOOTSTRAP__=${json};</script>`;
  c.header("Cache-Control", "no-store");
  return c.html(getSpaHtml().replace("</head>", `${script}</head>`));
});

// Start background jobs (replaces instrumentation-node.ts)
function startBackgroundJobs() {
  ensureStreamingTimeoutSweeperStarted();
  startHooksSubscriber();
  startRetentionCleanupJob();
  startDispatchBatchScheduler();
  startDispatchLeaseSweeper();
}

// Server startup
if (process.env.NODE_ENV !== "test") {
  // Initialize DB connection eagerly
  getDb();

  // Auto-generate VAPID keys if missing
  ensurePushProvisioned();

  // Start background jobs
  startBackgroundJobs();

  const config = loadOpengramConfig();
  const port = config.server.port;

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`OpenGram server listening on http://localhost:${info.port}`);
  });

  // Graceful shutdown — SSE connections are long-lived so we force-exit after a short grace period
  const shutdown = () => {
    server.close(() => process.exit(0));
    // Force exit after 2s if SSE/keep-alive connections don't drain on their own
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { startBackgroundJobs };
