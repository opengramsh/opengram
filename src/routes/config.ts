import { createRoute } from '@hono/zod-openapi';

import type { z } from '@hono/zod-openapi';

import { validationError } from '@/src/api/http';
import { AdminUpdateBodySchema, ConfigResponseSchema, ValidateAutoRenameBodySchema } from '@/src/api/schemas/config';
import { readErrorResponses, writeErrorResponses, createRouter, SuccessOkSchema } from '@/src/api/schemas/common';
import type { AgentConfig, ModelConfig } from '@/src/config/opengram-config';
import { readMiddleware, writeMiddleware } from '@/src/api/write-controls';
import { loadOpengramConfig, saveOpengramConfig, saveRawOpengramConfig } from '@/src/config/opengram-config';
import {
  RENAME_PROVIDERS,
  detectEnvApiKey,
  getEnvVarName,
  getProviderById,
  resolveApiKey,
  validateAutoRenameKey,
} from '@/src/services/auto-rename-service';

const config = createRouter();

const getConfigRoute = createRoute({
  operationId: 'getConfig',
  method: 'get',
  path: '/',
  tags: ['Config'],
  summary: 'Get instance configuration',
  security: [{ bearerAuth: [] }],
  middleware: [readMiddleware] as const,
  responses: {
    200: { content: { 'application/json': { schema: ConfigResponseSchema } }, description: 'Instance configuration' },
    ...readErrorResponses,
  },
});

config.openapi(getConfigRoute, (c) => {
  const cfg = loadOpengramConfig();

  const data = {
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
  };
  return c.json(data as z.infer<typeof ConfigResponseSchema>);
});

const patchAdminRoute = createRoute({
  operationId: 'updateAdminConfig',
  method: 'patch',
  path: '/admin',
  tags: ['Config'],
  summary: 'Update admin configuration',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    body: { content: { 'application/json': { schema: AdminUpdateBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: SuccessOkSchema } }, description: 'Configuration updated' },
    ...writeErrorResponses,
  },
});

config.openapi(patchAdminRoute, (c) => {
  try {
    const body = c.req.valid('json');
    if (body.rawConfig !== undefined) {
      if (typeof body.rawConfig !== 'object' || body.rawConfig === null || Array.isArray(body.rawConfig)) {
        throw validationError('rawConfig must be a JSON object');
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
        agents: Array.isArray(body.agents) ? (body.agents as AgentConfig[]) : undefined,
        models: Array.isArray(body.models) ? (body.models as ModelConfig[]) : undefined,
        security: securityUpdate,
        autoRename: autoRenameUpdate as Parameters<typeof saveOpengramConfig>[0]['autoRename'],
      });
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Config validation error:')) {
      throw validationError(err.message);
    }
    throw err;
  }
  return c.json({ ok: true as const });
});

const validateAutoRenameRoute = createRoute({
  operationId: 'validateAutoRename',
  method: 'post',
  path: '/admin/validate-auto-rename',
  tags: ['Config'],
  summary: 'Validate auto-rename API key',
  security: [{ bearerAuth: [] }],
  middleware: [writeMiddleware] as const,
  request: {
    body: { content: { 'application/json': { schema: ValidateAutoRenameBodySchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: SuccessOkSchema } }, description: 'Validation passed' },
    ...writeErrorResponses,
  },
});

config.openapi(validateAutoRenameRoute, async (c) => {
  const body = c.req.valid('json');

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
  return c.json({ ok: true as const });
});

export default config;
