import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateVapidKeys } from "@/src/services/push-crypto";

export type OpengramConfig = {
  appName: string;
  maxUploadBytes: number;
  allowedMimeTypes: string[];
  titleMaxChars: number;
  defaultModelIdForNewChats?: string;
  agents: AgentConfig[];
  models: ModelConfig[];
  push: PushConfig;
  security: SecurityConfig;
  server: ServerConfig;
  hooks: HookConfig[];
  autoRename?: AutoRenameConfig;
};

export type AgentConfig = {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
  defaultModelId?: string;
};

export type ModelConfig = {
  id: string;
  name: string;
  description: string;
  metadata?: Record<string, string>;
};

export type PushConfig = {
  enabled: boolean;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  subject: string;
};

export type SecurityConfig = {
  instanceSecretEnabled: boolean;
  instanceSecret: string;
  readEndpointsRequireInstanceSecret: boolean;
};

export type ServerConfig = {
  publicBaseUrl: string;
  port: number;
  streamTimeoutSeconds: number;
  corsOrigins: string[];
  idempotencyTtlSeconds: number;
  dispatch: DispatchConfig;
};

export type DispatchConfig = {
  mode: "immediate" | "sequential" | "batched_sequential";
  batchDebounceMs: number;
  typingGraceMs: number;
  maxBatchWaitMs: number;
  schedulerTickMs: number;
  leaseMs: number;
  heartbeatIntervalMs: number;
  claimWaitMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  maxAttempts: number;
  execution: DispatchExecutionConfig;
  claim: DispatchClaimConfig;
};

export type DispatchExecutionConfig = {
  autoscaleEnabled: boolean;
  minConcurrency: number;
  maxConcurrency: number;
  scaleCooldownMs: number;
};

export type DispatchClaimConfig = {
  claimManyLimit: number;
};

export type HookConfig = {
  url: string;
  events: string[];
  headers?: Record<string, string>;
  signingSecret?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type AutoRenameConfig = {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'google' | 'xai' | 'openrouter';
  modelId: string;
  apiKey?: string;
};

const DEFAULT_CONFIG_RELATIVE_PATH = "./config/opengram.config.json";

const defaultConfig: OpengramConfig = {
  appName: "OpenGram",
  maxUploadBytes: 50_000_000,
  allowedMimeTypes: ["*/*"],
  titleMaxChars: 48,
  defaultModelIdForNewChats: undefined,
  agents: [
    {
      id: "agent-default",
      name: "Default Agent",
      description: "Default local development agent.",
      defaultModelId: "model-default",
    },
  ],
  models: [
    {
      id: "model-default",
      name: "Default Model",
      description: "Default local development model.",
    },
  ],
  push: {
    enabled: false,
    vapidPublicKey: "",
    vapidPrivateKey: "",
    subject: "",
  },
  security: {
    instanceSecretEnabled: false,
    instanceSecret: "",
    readEndpointsRequireInstanceSecret: false,
  },
  server: {
    publicBaseUrl: "http://localhost:3000",
    port: 3000,
    streamTimeoutSeconds: 60,
    corsOrigins: [],
    idempotencyTtlSeconds: 24 * 60 * 60,
    dispatch: {
      mode: "batched_sequential",
      batchDebounceMs: 600,
      typingGraceMs: 2000,
      maxBatchWaitMs: 30000,
      schedulerTickMs: 500,
      leaseMs: 30000,
      heartbeatIntervalMs: 5000,
      claimWaitMs: 10000,
      retryBaseMs: 500,
      retryMaxMs: 30000,
      maxAttempts: 8,
      execution: {
        autoscaleEnabled: true,
        minConcurrency: 2,
        maxConcurrency: 10,
        scaleCooldownMs: 5000,
      },
      claim: {
        claimManyLimit: 10,
      },
    },
  },
  hooks: [],
};

function resolveConfigPath(configPath?: string) {
  if (configPath) {
    return path.resolve(configPath);
  }

  if (process.env.OPENGRAM_CONFIG_PATH) {
    return path.resolve(process.env.OPENGRAM_CONFIG_PATH);
  }

  return path.resolve(DEFAULT_CONFIG_RELATIVE_PATH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConfig(
  defaults: OpengramConfig,
  incoming: Record<string, unknown>,
): OpengramConfig {
  const incomingServer = isRecord(incoming.server) ? incoming.server : {};
  const incomingDispatch = isRecord(incomingServer.dispatch)
    ? incomingServer.dispatch
    : {};
  const incomingDispatchExecution = isRecord(incomingDispatch.execution)
    ? incomingDispatch.execution
    : {};
  const incomingDispatchClaim = isRecord(incomingDispatch.claim)
    ? incomingDispatch.claim
    : {};

  const merged: OpengramConfig = {
    ...defaults,
    ...incoming,
    push: {
      ...defaults.push,
      ...(isRecord(incoming.push) ? incoming.push : {}),
    },
    security: {
      ...defaults.security,
      ...(isRecord(incoming.security) ? incoming.security : {}),
    },
    server: {
      ...defaults.server,
      ...incomingServer,
      dispatch: {
        ...defaults.server.dispatch,
        ...incomingDispatch,
        execution: {
          ...defaults.server.dispatch.execution,
          ...incomingDispatchExecution,
        },
        claim: {
          ...defaults.server.dispatch.claim,
          ...incomingDispatchClaim,
        },
      },
    },
    hooks: Array.isArray(incoming.hooks)
      ? (incoming.hooks as HookConfig[])
      : defaults.hooks,
    agents: Array.isArray(incoming.agents)
      ? (incoming.agents as AgentConfig[])
      : defaults.agents,
    models: Array.isArray(incoming.models)
      ? (incoming.models as ModelConfig[])
      : defaults.models,
    allowedMimeTypes: Array.isArray(incoming.allowedMimeTypes)
      ? (incoming.allowedMimeTypes as string[])
      : defaults.allowedMimeTypes,
    autoRename: isRecord(incoming.autoRename)
      ? (incoming.autoRename as unknown as AutoRenameConfig)
      : defaults.autoRename,
  };

  return merged;
}

function validateConfig(config: OpengramConfig): OpengramConfig {
  if (!config.models.length) {
    throw new Error("Config validation error: at least one model is required.");
  }

  if (!config.agents.length) {
    throw new Error("Config validation error: at least one agent is required.");
  }

  const modelIds = new Set(config.models.map((model) => model.id));

  if (
    config.defaultModelIdForNewChats &&
    !modelIds.has(config.defaultModelIdForNewChats)
  ) {
    throw new Error(
      "Config validation error: defaultModelIdForNewChats must match one configured model id.",
    );
  }

  for (const agent of config.agents) {
    if (agent.defaultModelId && !modelIds.has(agent.defaultModelId)) {
      throw new Error(
        `Config validation error: agent "${agent.id}" references unknown defaultModelId "${agent.defaultModelId}".`,
      );
    }
  }

  if (
    config.security.instanceSecretEnabled &&
    !config.security.instanceSecret
  ) {
    throw new Error(
      "Config validation error: security.instanceSecret is required when enabled.",
    );
  }

  if (config.push.enabled) {
    if (
      !config.push.vapidPublicKey ||
      !config.push.vapidPrivateKey ||
      !config.push.subject
    ) {
      throw new Error(
        "Config validation error: push keys and subject are required when push.enabled=true.",
      );
    }
    if (config.push.subject.includes("localhost")) {
      console.warn(
        "[push] Warning: VAPID subject contains 'localhost' — Apple Web Push (and some other providers) will reject push tokens.\n" +
        "  → Set \"server\".\"publicBaseUrl\" to your HTTPS URL in config/opengram.config.json\n" +
        "    (or set the OPENGRAM_PUBLIC_BASE_URL environment variable) and restart the server.\n" +
        "  → The subject will be auto-repaired on the next startup once a valid URL is configured.",
      );
    }
  }

  if (
    !Number.isInteger(config.server.idempotencyTtlSeconds) ||
    config.server.idempotencyTtlSeconds <= 0
  ) {
    throw new Error(
      "Config validation error: server.idempotencyTtlSeconds must be a positive integer.",
    );
  }

  if (!Array.isArray(config.server.corsOrigins)) {
    throw new Error(
      "Config validation error: server.corsOrigins must be an array of origins.",
    );
  }

  if (
    !config.server.corsOrigins.every((origin) => typeof origin === "string")
  ) {
    throw new Error(
      "Config validation error: server.corsOrigins must be an array of strings.",
    );
  }

  if (
    config.server.dispatch.mode !== "immediate" &&
    config.server.dispatch.mode !== "sequential" &&
    config.server.dispatch.mode !== "batched_sequential"
  ) {
    throw new Error(
      "Config validation error: server.dispatch.mode must be one of immediate, sequential, batched_sequential.",
    );
  }

  const dispatchIntegerFields: Array<
    Exclude<keyof DispatchConfig, "mode" | "execution" | "claim">
  > =
    [
      "batchDebounceMs",
      "typingGraceMs",
      "maxBatchWaitMs",
      "schedulerTickMs",
      "leaseMs",
      "heartbeatIntervalMs",
      "claimWaitMs",
      "retryBaseMs",
      "retryMaxMs",
      "maxAttempts",
    ];

  for (const field of dispatchIntegerFields) {
    const value = config.server.dispatch[field];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `Config validation error: server.dispatch.${field} must be a non-negative integer.`,
      );
    }
  }

  if (config.server.dispatch.maxAttempts < 1) {
    throw new Error(
      "Config validation error: server.dispatch.maxAttempts must be at least 1.",
    );
  }

  if (typeof config.server.dispatch.execution.autoscaleEnabled !== "boolean") {
    throw new Error(
      "Config validation error: server.dispatch.execution.autoscaleEnabled must be a boolean.",
    );
  }

  const executionIntegerFields: Array<
    Exclude<keyof DispatchExecutionConfig, "autoscaleEnabled">
  > = ["minConcurrency", "maxConcurrency", "scaleCooldownMs"];
  for (const field of executionIntegerFields) {
    const value = config.server.dispatch.execution[field];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `Config validation error: server.dispatch.execution.${field} must be a non-negative integer.`,
      );
    }
  }

  if (config.server.dispatch.execution.minConcurrency < 1) {
    throw new Error(
      "Config validation error: server.dispatch.execution.minConcurrency must be at least 1.",
    );
  }

  if (config.server.dispatch.execution.maxConcurrency < 1) {
    throw new Error(
      "Config validation error: server.dispatch.execution.maxConcurrency must be at least 1.",
    );
  }

  if (
    config.server.dispatch.execution.maxConcurrency <
    config.server.dispatch.execution.minConcurrency
  ) {
    throw new Error(
      "Config validation error: server.dispatch.execution.maxConcurrency must be greater than or equal to minConcurrency.",
    );
  }

  const claimManyLimit = config.server.dispatch.claim.claimManyLimit;
  if (!Number.isInteger(claimManyLimit) || claimManyLimit < 1) {
    throw new Error(
      "Config validation error: server.dispatch.claim.claimManyLimit must be at least 1.",
    );
  }

  const normalizedCorsOrigins: string[] = [];
  for (const rawOrigin of config.server.corsOrigins) {
    const trimmedOrigin = rawOrigin.trim();
    if (!trimmedOrigin) {
      throw new Error(
        "Config validation error: server.corsOrigins cannot include empty values.",
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmedOrigin);
    } catch {
      throw new Error(
        `Config validation error: server.corsOrigins contains invalid URL "${rawOrigin}".`,
      );
    }

    if (parsed.origin === "null") {
      throw new Error(
        `Config validation error: server.corsOrigins must use http/https origins. Invalid value "${rawOrigin}".`,
      );
    }

    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(
        `Config validation error: server.corsOrigins entries must be origins only (no path/query/hash). Invalid value "${rawOrigin}".`,
      );
    }

    const normalizedOrigin = parsed.origin;
    if (!normalizedCorsOrigins.includes(normalizedOrigin)) {
      normalizedCorsOrigins.push(normalizedOrigin);
    }
  }
  config.server.corsOrigins = normalizedCorsOrigins;

  if (config.autoRename && config.autoRename.enabled) {
    const validProviders = ['anthropic', 'openai', 'google', 'xai', 'openrouter'];
    if (!validProviders.includes(config.autoRename.provider)) {
      throw new Error(
        `Config validation error: autoRename.provider must be one of ${validProviders.join(', ')}.`,
      );
    }
    if (!config.autoRename.modelId || typeof config.autoRename.modelId !== 'string') {
      throw new Error(
        "Config validation error: autoRename.modelId is required when autoRename is enabled.",
      );
    }
  }

  return config;
}

type ConfigCache = {
  resolvedPath: string;
  mtimeMs: number | null;
  envOverridesSnapshot: string;
  config: OpengramConfig;
};

let configCache: ConfigCache | null = null;

function getEnvOverridesSnapshot(): string {
  return JSON.stringify([
    process.env.OPENGRAM_SERVER_PORT,
    process.env.OPENGRAM_PUBLIC_BASE_URL,
    process.env.OPENGRAM_INSTANCE_SECRET,
    process.env.OPENGRAM_CORS_ORIGINS,
  ]);
}

function applyEnvOverrides(config: OpengramConfig): OpengramConfig {
  const rawPort = process.env.OPENGRAM_SERVER_PORT;
  if (rawPort !== undefined) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(
        "Config validation error: OPENGRAM_SERVER_PORT must be an integer between 1 and 65535.",
      );
    }
    config.server.port = port;
  }

  const rawPublicBaseUrl = process.env.OPENGRAM_PUBLIC_BASE_URL;
  if (rawPublicBaseUrl !== undefined && rawPublicBaseUrl.trim() !== "") {
    config.server.publicBaseUrl = rawPublicBaseUrl.trim();
  }

  const rawInstanceSecret = process.env.OPENGRAM_INSTANCE_SECRET;
  if (rawInstanceSecret !== undefined && rawInstanceSecret.trim() !== "") {
    config.security.instanceSecret = rawInstanceSecret.trim();
    config.security.instanceSecretEnabled = true;
  }

  const rawCorsOrigins = process.env.OPENGRAM_CORS_ORIGINS;
  if (rawCorsOrigins !== undefined) {
    const origins = rawCorsOrigins
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (origins.length > 0) {
      config.server.corsOrigins = origins;
    }
  }

  return config;
}

export function loadOpengramConfig(configPath?: string): OpengramConfig {
  const resolvedPath = resolveConfigPath(configPath);
  const envOverridesSnapshot = getEnvOverridesSnapshot();

  if (configCache && configCache.resolvedPath === resolvedPath) {
    if (configCache.envOverridesSnapshot !== envOverridesSnapshot) {
      configCache = null;
    } else {
      if (configCache.mtimeMs === null) {
        // Cached "no file" result — re-check existence
        if (!existsSync(resolvedPath)) {
          return configCache.config;
        }
      } else {
        try {
          const stat = statSync(resolvedPath);
          if (stat.mtimeMs === configCache.mtimeMs) {
            return configCache.config;
          }
        } catch {
          // File was removed since last cache — fall through to re-read
        }
      }
    }
  }

  const hasFile = existsSync(resolvedPath);
  if (!hasFile) {
    const config = validateConfig(
      applyEnvOverrides(structuredClone(defaultConfig)),
    );
    configCache = { resolvedPath, mtimeMs: null, envOverridesSnapshot, config };
    return config;
  }

  const raw = readFileSync(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(
      `Config validation error: expected JSON object at ${resolvedPath}.`,
    );
  }

  const merged = mergeConfig(structuredClone(defaultConfig), parsed);
  const config = validateConfig(applyEnvOverrides(merged));

  let mtimeMs: number | null = null;
  try {
    mtimeMs = statSync(resolvedPath).mtimeMs;
  } catch {
    // Unlikely race — file removed between read and stat; still cache it
  }

  configCache = { resolvedPath, mtimeMs, envOverridesSnapshot, config };
  return config;
}

export function saveOpengramConfig(
  updates: {
    agents?: AgentConfig[];
    models?: ModelConfig[];
    security?: Partial<SecurityConfig>;
    autoRename?: AutoRenameConfig | null;
  },
  configPath?: string,
): void {
  const resolvedPath = resolveConfigPath(configPath);

  // Read current config from disk (or default) as a plain object
  let current: Record<string, unknown> = {};
  if (existsSync(resolvedPath)) {
    const raw = readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      current = parsed;
    }
  }

  // Merge updates
  if (updates.agents !== undefined) {
    current.agents = updates.agents;
  }
  if (updates.models !== undefined) {
    current.models = updates.models;
    // Clear the deprecated defaultModelIdForNewChats — it may now reference
    // a model ID that no longer exists in the updated list.
    delete current.defaultModelIdForNewChats;
  }
  if (updates.security !== undefined) {
    const existingSecurity = isRecord(current.security) ? current.security : {};
    current.security = { ...existingSecurity, ...updates.security };
  }
  if (updates.autoRename !== undefined) {
    if (updates.autoRename === null) {
      delete current.autoRename;
    } else {
      const existing = isRecord(current.autoRename) ? current.autoRename : {};
      const merged: Record<string, unknown> = { ...existing, ...updates.autoRename };
      // Preserve existing apiKey if not provided in update
      if (updates.autoRename.apiKey === undefined && existing.apiKey) {
        merged.apiKey = existing.apiKey;
      }
      // Remove apiKey if explicitly set to empty string
      if (merged.apiKey === '') {
        delete merged.apiKey;
      }
      current.autoRename = merged;
    }
  }

  // Validate by running through the full load pipeline on the merged result
  const merged = mergeConfig(structuredClone(defaultConfig), current);

  // Auto-create stub models for agent defaultModelId references
  // when agents are pushed without explicit model management.
  if (updates.agents !== undefined && updates.models === undefined) {
    const existingModelIds = new Set(merged.models.map((m) => m.id));
    const stubModels: ModelConfig[] = [];

    for (const agent of merged.agents) {
      if (agent.defaultModelId && !existingModelIds.has(agent.defaultModelId)) {
        existingModelIds.add(agent.defaultModelId);
        stubModels.push({
          id: agent.defaultModelId,
          name: agent.defaultModelId,
          description: '',
        });
      }
    }

    if (stubModels.length > 0) {
      const currentModels = Array.isArray(current.models) ? current.models as ModelConfig[] : [];
      current.models = [...currentModels, ...stubModels];
      merged.models = [...merged.models, ...stubModels];
    }
  }

  validateConfig(merged);

  // Write back as pretty JSON
  writeFileSync(resolvedPath, JSON.stringify(current, null, 2) + "\n", "utf8");

  // Invalidate cache so next read picks up the new file
  configCache = null;
}

export function saveRawOpengramConfig(
  raw: Record<string, unknown>,
  configPath?: string,
): void {
  const resolvedPath = resolveConfigPath(configPath);

  // Validate by running through the full load pipeline
  const merged = mergeConfig(structuredClone(defaultConfig), raw);
  validateConfig(merged);

  // Write back as pretty JSON
  writeFileSync(resolvedPath, JSON.stringify(raw, null, 2) + "\n", "utf8");

  // Invalidate cache so next read picks up the new file
  configCache = null;
}

function derivePushSubject(config: OpengramConfig): string {
  if (config.server.publicBaseUrl.startsWith("https://")) {
    return config.server.publicBaseUrl;
  }

  const httpsOrigin = config.server.corsOrigins.find((o) =>
    o.startsWith("https://"),
  );
  return httpsOrigin ?? "mailto:opengram@localhost";
}

export function ensurePushProvisioned(configPath?: string): void {
  const config = loadOpengramConfig(configPath);
  const resolvedPath = resolveConfigPath(configPath);

  // Keys already exist — check if subject needs repair
  if (config.push.vapidPublicKey && config.push.vapidPrivateKey) {
    if (config.push.subject.includes("localhost")) {
      const newSubject = derivePushSubject(config);
      if (!newSubject.includes("localhost") && newSubject !== config.push.subject) {
        let current: Record<string, unknown> = {};
        if (existsSync(resolvedPath)) {
          const raw = readFileSync(resolvedPath, "utf8");
          const parsed = JSON.parse(raw) as unknown;
          if (isRecord(parsed)) {
            current = parsed;
          }
        }

        const existingPush = isRecord(current.push) ? current.push : {};
        current.push = { ...existingPush, subject: newSubject };

        writeFileSync(resolvedPath, JSON.stringify(current, null, 2) + "\n", "utf8");
        configCache = null;

        console.log(
          `[push] Repaired VAPID subject: ${config.push.subject} → ${newSubject}`,
        );
      }
    }
    return;
  }

  const keys = generateVapidKeys();
  const subject = derivePushSubject(config);

  let current: Record<string, unknown> = {};
  if (existsSync(resolvedPath)) {
    const raw = readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      current = parsed;
    }
  }

  const existingPush = isRecord(current.push) ? current.push : {};
  current.push = {
    ...existingPush,
    enabled: true,
    vapidPublicKey: keys.publicKey,
    vapidPrivateKey: keys.privateKey,
    subject,
  };

  const merged = mergeConfig(structuredClone(defaultConfig), current);
  validateConfig(merged);

  writeFileSync(resolvedPath, JSON.stringify(current, null, 2) + "\n", "utf8");
  configCache = null;

  console.log(
    "[push] Auto-generated VAPID keys and enabled push notifications.",
  );
}

export function repairPushSubjectFromOrigin(origin: string): void {
  const config = loadOpengramConfig();

  // Already fixed — nothing to do
  if (!config.push.subject.includes("localhost")) return;

  // Only trust HTTPS origins
  if (!origin.startsWith("https://")) return;

  const resolvedPath = resolveConfigPath();

  let current: Record<string, unknown> = {};
  if (existsSync(resolvedPath)) {
    const raw = readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      current = parsed;
    }
  }

  const existingPush = isRecord(current.push) ? current.push : {};
  current.push = { ...existingPush, subject: origin };

  const existingServer = isRecord(current.server) ? current.server : {};
  current.server = { ...existingServer, publicBaseUrl: origin };

  writeFileSync(resolvedPath, JSON.stringify(current, null, 2) + "\n", "utf8");
  configCache = null;

  console.log(
    `[push] Auto-detected public URL from Origin header — repaired VAPID subject: ${config.push.subject} → ${origin}`,
  );
}

export function resetConfigCacheForTests() {
  configCache = null;
}

export const OPEN_GRAM_DEFAULT_CONFIG = defaultConfig;
