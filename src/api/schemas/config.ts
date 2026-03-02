import { z } from '@hono/zod-openapi';

const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  avatarUrl: z.string().optional(),
  defaultModelId: z.string().optional(),
}).passthrough().openapi('AgentConfig');

const ModelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  metadata: z.record(z.string(), z.string()).optional(),
}).passthrough().openapi('ModelConfig');

const HookConfigSchema = z.object({
  url: z.string(),
  events: z.array(z.string()),
  timeoutMs: z.number(),
  maxRetries: z.number(),
});

const RenameProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  envVar: z.string(),
  hasEnvKey: z.boolean(),
  cheapModels: z.array(z.object({ id: z.string(), label: z.string() })),
});

export const ConfigResponseSchema = z.object({
  appName: z.string(),
  maxUploadBytes: z.number(),
  allowedMimeTypes: z.array(z.string()),
  titleMaxChars: z.number(),
  defaultModelIdForNewChats: z.string().optional(),
  agents: z.array(AgentConfigSchema),
  models: z.array(ModelConfigSchema),
  push: z.object({
    enabled: z.boolean(),
    vapidPublicKey: z.string().nullable(),
    subject: z.string().nullable(),
  }),
  security: z.object({
    instanceSecretEnabled: z.boolean(),
    readEndpointsRequireInstanceSecret: z.boolean(),
  }),
  server: z.object({
    publicBaseUrl: z.string(),
    port: z.number(),
    streamTimeoutSeconds: z.number(),
    idempotencyTtlSeconds: z.number(),
    dispatch: z.object({
      mode: z.enum(['immediate', 'sequential', 'batched_sequential']),
      batchDebounceMs: z.number(),
      typingGraceMs: z.number(),
      maxBatchWaitMs: z.number(),
      schedulerTickMs: z.number(),
      leaseMs: z.number(),
      heartbeatIntervalMs: z.number(),
      claimWaitMs: z.number(),
      retryBaseMs: z.number(),
      retryMaxMs: z.number(),
    }).passthrough().openapi('DispatchConfig'),
  }),
  hooks: z.array(HookConfigSchema),
  autoRename: z.object({
    enabled: z.boolean(),
    provider: z.string(),
    modelId: z.string(),
    hasApiKey: z.boolean(),
  }).nullable(),
  autoRenameProviders: z.array(RenameProviderSchema),
}).openapi('ConfigResponse');

export const AdminUpdateBodySchema = z.object({
  agents: z.array(z.record(z.string(), z.unknown())).optional().openapi({ description: 'Agent configurations' }),
  models: z.array(z.record(z.string(), z.unknown())).optional().openapi({ description: 'Model configurations' }),
  security: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Security settings' }),
  autoRename: z.union([z.record(z.string(), z.unknown()), z.null()]).optional().openapi({ description: 'Auto-rename settings (null to disable)' }),
  rawConfig: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Replace the entire config file (mutually exclusive with other fields)' }),
}).openapi('AdminUpdateInput');

export const ValidateAutoRenameBodySchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  apiKey: z.string().optional(),
}).openapi('ValidateAutoRenameInput');
