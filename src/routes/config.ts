import { Hono } from 'hono';

import { toErrorResponse, validationError } from '@/src/api/http';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { loadOpengramConfig, saveOpengramConfig, saveRawOpengramConfig } from '@/src/config/opengram-config';
import {
  RENAME_PROVIDERS,
  detectEnvApiKey,
  getEnvVarName,
  getProviderById,
  resolveApiKey,
  validateAutoRenameKey,
} from '@/src/services/auto-rename-service';

const config = new Hono();

config.get('/', (c) => {
  try {
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
        dispatch: cfg.server.dispatch,
      },
      hooks: cfg.hooks.map((hook) => ({
        url: hook.url,
        events: hook.events,
        timeoutMs: hook.timeoutMs,
        maxRetries: hook.maxRetries,
      })),
      autoRename: cfg.autoRename
        ? {
            enabled: cfg.autoRename.enabled,
            provider: cfg.autoRename.provider,
            modelId: cfg.autoRename.modelId,
            hasApiKey: Boolean(cfg.autoRename.apiKey),
          }
        : null,
      autoRenameProviders: RENAME_PROVIDERS.map((p) => ({
        id: p.id,
        name: p.name,
        envVar: getEnvVarName(p),
        hasEnvKey: detectEnvApiKey(p),
        cheapModels: p.cheapModels,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

config.patch('/admin', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const body = (await c.req.json()) as { agents?: unknown; models?: unknown; security?: unknown; autoRename?: unknown; rawConfig?: unknown };
    if (body.rawConfig !== undefined) {
      if (typeof body.rawConfig !== 'object' || body.rawConfig === null || Array.isArray(body.rawConfig)) {
        return c.json({ error: 'rawConfig must be a JSON object' }, 400);
      }
      saveRawOpengramConfig(body.rawConfig as Record<string, unknown>);
    } else {
      const securityUpdate = typeof body.security === 'object' && body.security !== null && !Array.isArray(body.security)
        ? (body.security as Record<string, unknown>)
        : undefined;
      const autoRenameUpdate = body.autoRename === null
        ? null
        : typeof body.autoRename === 'object' && body.autoRename !== null && !Array.isArray(body.autoRename)
          ? (body.autoRename as Record<string, unknown>)
          : undefined;
      saveOpengramConfig({
        agents: Array.isArray(body.agents) ? body.agents : undefined,
        models: Array.isArray(body.models) ? body.models : undefined,
        security: securityUpdate,
        autoRename: autoRenameUpdate as Parameters<typeof saveOpengramConfig>[0]['autoRename'],
      });
    }
    return c.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
});

config.post('/admin/validate-auto-rename', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const body = (await c.req.json()) as { provider?: string; modelId?: string; apiKey?: string };

    if (!body.provider || !body.modelId) {
      throw validationError('provider and modelId are required.');
    }

    const provider = getProviderById(body.provider);
    if (!provider) {
      throw validationError(`Unknown provider: ${body.provider}`);
    }

    const cfg = loadOpengramConfig();
    const configApiKey = cfg.autoRename?.apiKey;
    const apiKey = resolveApiKey(provider, body.apiKey?.trim() || configApiKey);
    if (!apiKey) {
      const envVar = getEnvVarName(provider);
      throw validationError(
        `No API key available. Set the ${envVar} environment variable or provide a key in the settings.`,
      );
    }

    await validateAutoRenameKey(provider.id, body.modelId, apiKey);
    return c.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export default config;
