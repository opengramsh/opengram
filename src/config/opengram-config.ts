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
};

export type HookConfig = {
  url: string;
  events: string[];
  headers?: Record<string, string>;
  signingSecret?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

const DEFAULT_CONFIG_RELATIVE_PATH = "./config/opengram.config.json";
const PROD_CONFIG_PATH = "/opt/opengram/config/opengram.config.json";

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

  return process.env.NODE_ENV === "production"
    ? PROD_CONFIG_PATH
    : path.resolve(DEFAULT_CONFIG_RELATIVE_PATH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConfig(defaults: OpengramConfig, incoming: Record<string, unknown>): OpengramConfig {
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
      ...(isRecord(incoming.server) ? incoming.server : {}),
    },
    hooks: Array.isArray(incoming.hooks) ? (incoming.hooks as HookConfig[]) : defaults.hooks,
    agents: Array.isArray(incoming.agents) ? (incoming.agents as AgentConfig[]) : defaults.agents,
    models: Array.isArray(incoming.models) ? (incoming.models as ModelConfig[]) : defaults.models,
    allowedMimeTypes: Array.isArray(incoming.allowedMimeTypes)
      ? (incoming.allowedMimeTypes as string[])
      : defaults.allowedMimeTypes,
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

  if (config.defaultModelIdForNewChats && !modelIds.has(config.defaultModelIdForNewChats)) {
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

  if (config.security.instanceSecretEnabled && !config.security.instanceSecret) {
    throw new Error("Config validation error: security.instanceSecret is required when enabled.");
  }

  if (config.push.enabled) {
    if (!config.push.vapidPublicKey || !config.push.vapidPrivateKey || !config.push.subject) {
      throw new Error("Config validation error: push keys and subject are required when push.enabled=true.");
    }
    if (config.push.subject.includes("localhost")) {
      console.warn("[push] Warning: VAPID subject contains 'localhost' — Apple Web Push will reject tokens. Update push.subject in config.");
    }
  }

  if (!Number.isInteger(config.server.idempotencyTtlSeconds) || config.server.idempotencyTtlSeconds <= 0) {
    throw new Error("Config validation error: server.idempotencyTtlSeconds must be a positive integer.");
  }

  if (!Array.isArray(config.server.corsOrigins)) {
    throw new Error("Config validation error: server.corsOrigins must be an array of origins.");
  }

  if (!config.server.corsOrigins.every((origin) => typeof origin === "string")) {
    throw new Error("Config validation error: server.corsOrigins must be an array of strings.");
  }

  const normalizedCorsOrigins: string[] = [];
  for (const rawOrigin of config.server.corsOrigins) {
    const trimmedOrigin = rawOrigin.trim();
    if (!trimmedOrigin) {
      throw new Error("Config validation error: server.corsOrigins cannot include empty values.");
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmedOrigin);
    } catch {
      throw new Error(`Config validation error: server.corsOrigins contains invalid URL "${rawOrigin}".`);
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

  return config;
}

function syncCorsOriginsEnv(corsOrigins: string[]) {
  if (!corsOrigins.length) {
    delete process.env.OPENGRAM_CORS_ORIGINS;
    return;
  }

  process.env.OPENGRAM_CORS_ORIGINS = corsOrigins.join(',');
}

type ConfigCache = {
  resolvedPath: string;
  mtimeMs: number | null;
  envServerPortRaw: string | undefined;
  config: OpengramConfig;
};

let configCache: ConfigCache | null = null;

function applyEnvOverrides(config: OpengramConfig): OpengramConfig {
  const rawPort = process.env.OPENGRAM_SERVER_PORT;
  if (rawPort === undefined) {
    return config;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Config validation error: OPENGRAM_SERVER_PORT must be an integer between 1 and 65535.");
  }

  config.server.port = port;
  return config;
}

export function loadOpengramConfig(configPath?: string): OpengramConfig {
  const resolvedPath = resolveConfigPath(configPath);
  const envServerPortRaw = process.env.OPENGRAM_SERVER_PORT;

  if (configCache && configCache.resolvedPath === resolvedPath) {
    if (configCache.envServerPortRaw !== envServerPortRaw) {
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
    const config = validateConfig(applyEnvOverrides(structuredClone(defaultConfig)));
    syncCorsOriginsEnv(config.server.corsOrigins);
    configCache = { resolvedPath, mtimeMs: null, envServerPortRaw, config };
    return config;
  }

  const raw = readFileSync(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed)) {
    throw new Error(`Config validation error: expected JSON object at ${resolvedPath}.`);
  }

  const merged = mergeConfig(structuredClone(defaultConfig), parsed);
  const config = validateConfig(applyEnvOverrides(merged));
  syncCorsOriginsEnv(config.server.corsOrigins);

  let mtimeMs: number | null = null;
  try {
    mtimeMs = statSync(resolvedPath).mtimeMs;
  } catch {
    // Unlikely race — file removed between read and stat; still cache it
  }

  configCache = { resolvedPath, mtimeMs, envServerPortRaw, config };
  return config;
}

export function saveOpengramConfig(
  updates: { agents?: AgentConfig[]; models?: ModelConfig[]; security?: Partial<SecurityConfig> },
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

  // Validate by running through the full load pipeline on the merged result
  const merged = mergeConfig(structuredClone(defaultConfig), current);
  validateConfig(merged);

  // Write back as pretty JSON
  writeFileSync(resolvedPath, JSON.stringify(current, null, 2) + "\n", "utf8");

  // Invalidate cache so next read picks up the new file
  configCache = null;
}

export function saveRawOpengramConfig(raw: Record<string, unknown>, configPath?: string): void {
  const resolvedPath = resolveConfigPath(configPath);

  // Validate by running through the full load pipeline
  const merged = mergeConfig(structuredClone(defaultConfig), raw);
  validateConfig(merged);

  // Write back as pretty JSON
  writeFileSync(resolvedPath, JSON.stringify(raw, null, 2) + "\n", "utf8");

  // Invalidate cache so next read picks up the new file
  configCache = null;
}

export function ensurePushProvisioned(configPath?: string): void {
  const config = loadOpengramConfig(configPath);

  if (config.push.vapidPublicKey || config.push.vapidPrivateKey) {
    return;
  }

  const keys = generateVapidKeys();
  let subject: string;
  if (config.server.publicBaseUrl.startsWith("https://")) {
    subject = config.server.publicBaseUrl;
  } else {
    const httpsOrigin = config.server.corsOrigins.find(o => o.startsWith("https://"));
    subject = httpsOrigin ?? "mailto:opengram@localhost";
  }

  const resolvedPath = resolveConfigPath(configPath);
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

  console.log("[push] Auto-generated VAPID keys and enabled push notifications.");
}

export function resetConfigCacheForTests() {
  configCache = null;
}

export const OPEN_GRAM_DEFAULT_CONFIG = defaultConfig;
