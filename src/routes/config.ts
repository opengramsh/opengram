import { Hono } from 'hono';

import { toErrorResponse } from '@/src/api/http';
import { applyReadMiddlewares, applyWriteMiddlewares } from '@/src/api/write-controls';
import { loadOpengramConfig, saveOpengramConfig, saveRawOpengramConfig } from '@/src/config/opengram-config';

const config = new Hono();

config.get('/', (c) => {
  try {
    applyReadMiddlewares(c.req.raw);
    const cfg = loadOpengramConfig();

    return c.json({
      appName: cfg.appName,
      maxUploadBytes: cfg.maxUploadBytes,
      allowedMimeTypes: cfg.allowedMimeTypes,
      titleMaxChars: cfg.titleMaxChars,
      defaultModelIdForNewChats: cfg.defaultModelIdForNewChats,
      agents: cfg.agents,
      models: cfg.models,
      push: {
        enabled: cfg.push.enabled,
        vapidPublicKey: cfg.push.vapidPublicKey,
        subject: cfg.push.subject,
      },
      security: {
        instanceSecretEnabled: cfg.security.instanceSecretEnabled,
        readEndpointsRequireInstanceSecret: cfg.security.readEndpointsRequireInstanceSecret,
      },
      server: {
        publicBaseUrl: cfg.server.publicBaseUrl,
        port: cfg.server.port,
        streamTimeoutSeconds: cfg.server.streamTimeoutSeconds,
        idempotencyTtlSeconds: cfg.server.idempotencyTtlSeconds,
      },
      hooks: cfg.hooks.map((hook) => ({
        url: hook.url,
        events: hook.events,
        timeoutMs: hook.timeoutMs,
        maxRetries: hook.maxRetries,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

config.patch('/admin', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const body = (await c.req.json()) as { agents?: unknown; models?: unknown; rawConfig?: unknown };
    if (body.rawConfig !== undefined) {
      if (typeof body.rawConfig !== 'object' || body.rawConfig === null || Array.isArray(body.rawConfig)) {
        return c.json({ error: 'rawConfig must be a JSON object' }, 400);
      }
      saveRawOpengramConfig(body.rawConfig as Record<string, unknown>);
    } else {
      saveOpengramConfig({
        agents: Array.isArray(body.agents) ? body.agents : undefined,
        models: Array.isArray(body.models) ? body.models : undefined,
      });
    }
    return c.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export default config;
