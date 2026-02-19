import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk";

import { OpenGramClient } from "./api-client.js";
import { initializeChatManager } from "./chat-manager.js";
import { OpenGramConfigSchema, resolveOpenGramAccount, type ResolvedOpenGramAccount } from "./config.js";
import { sendMedia, sendText } from "./outbound.js";

export const opengramPlugin: ChannelPlugin<ResolvedOpenGramAccount> = {
  id: "opengram",
  meta: {
    id: "opengram",
    label: "OpenGram",
    selectionLabel: "OpenGram (self-hosted)",
    docsPath: "/channels/opengram",
    blurb: "Mobile-first PWA for AI agent chat + task management.",
    aliases: ["og"],
    order: 10,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    threads: false,
    reactions: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.opengram"] },
  configSchema: buildChannelConfigSchema(OpenGramConfigSchema),
  config: {
    listAccountIds: (cfg) => (cfg.channels?.opengram?.enabled !== false ? ["default"] : []),
    resolveAccount: (cfg, accountId) => resolveOpenGramAccount(cfg, accountId ?? "default"),
    defaultAccountId: () => "default",
    isConfigured: (account) => Boolean(account.config.baseUrl?.trim()),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.config.baseUrl?.trim()),
      baseUrl: account.config.baseUrl,
    }),
  },
  security: {
    resolveDmPolicy: () => ({
      policy: "open",
      allowFrom: [],
      allowFromPath: "channels.opengram.",
      approveHint: "OpenGram is designed for private access via Tailscale.",
    }),
  },
  messaging: {
    normalizeTarget: (raw) => raw.trim(),
    targetResolver: {
      looksLikeId: (raw) => /^[a-zA-Z0-9_-]{10,30}$/.test(raw),
      hint: "<chatId>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 50000,
    chunker: null,
    sendText,
    sendMedia,
  },
  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    probeAccount: async ({ account }) => {
      try {
        const client = new OpenGramClient(account.config.baseUrl, account.config.instanceSecret);
        const health = await client.health();
        return { ok: true, version: health.version, uptime: health.uptime };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.config.baseUrl?.trim()),
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      baseUrl: account.config.baseUrl,
      probe,
    }),
  },
  gateway: {
    start: async ({ cfg, account, logger }) => {
      const client = new OpenGramClient(account.config.baseUrl, account.config.instanceSecret);
      await initializeChatManager(client, cfg);
      logger.info("OpenGram plugin gateway initialized");
      return { stop: async () => void 0 };
    },
  },
};
