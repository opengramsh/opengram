import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk";

import { OpenGramClient } from "./api-client.js";
import { getActiveChatIds, initializeChatManager } from "./chat-manager.js";
import { OpenGramConfigSchema, resolveOpenGramAccount, type ResolvedOpenGramAccount } from "./config.js";
import { startInboundListener } from "./inbound.js";
import { opengramOnboardingAdapter } from "./onboarding.js";
import { sendMedia, sendText } from "./outbound.js";
import { opengramChatTool } from "./tools/opengram-chat.js";
import { opengramMediaTool } from "./tools/opengram-media.js";
import { opengramRequestTool } from "./tools/opengram-request.js";
import { opengramSearchTool } from "./tools/opengram-search.js";

/** Access the opengram config section from the raw config. */
function getOpenGramSection(cfg: OpenClawConfig | undefined | null): Record<string, any> | undefined {
  return (cfg?.channels as Record<string, any> | undefined)?.opengram;
}

export const opengramPlugin: ChannelPlugin<ResolvedOpenGramAccount> = {
  id: "opengram",
  meta: {
    id: "opengram",
    label: "OpenGram",
    selectionLabel: "OpenGram (self-hosted)",
    docsPath: "/channels/opengram",
    blurb: "Mobile-first PWA for AI agent chat + task management.",
    aliases: ["og"],
    order: 20,
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
  onboarding: opengramOnboardingAdapter,
  configSchema: buildChannelConfigSchema(OpenGramConfigSchema),
  config: {
    listAccountIds: (cfg) => (getOpenGramSection(cfg)?.enabled !== false ? ["default"] : []),
    resolveAccount: (cfg, accountId) => resolveOpenGramAccount(cfg as any, accountId ?? "default"),
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
    resolveDmPolicy: ({ account }) => ({
      policy: account.config.dmPolicy ?? "pairing",
      allowFrom: account.config.allowFrom,
      allowFromPath: "channels.opengram.allowFrom",
      approveHint: "OpenGram is designed for private access via Tailscale.",
    }),
  },
  pairing: {
    idLabel: "opengramUserId",
    notifyApproval: async ({ cfg, id }) => {
      const section = getOpenGramSection(cfg);
      if (!section?.baseUrl) return;
      try {
        const client = new OpenGramClient(section.baseUrl, section.instanceSecret);
        const chats = await client.listChats({ limit: 1 });
        const chatId = chats.data?.[0]?.id;
        if (chatId) {
          await client.createMessage(chatId, {
            role: "system",
            senderId: "openclaw",
            content: `OpenClaw access approved for ${id}.`,
          });
        }
      } catch {
        // Best-effort notification — don't fail the approval flow.
      }
    },
  },
  messaging: {
    normalizeTarget: (raw) => raw.trim(),
    targetResolver: {
      looksLikeId: (raw) => /^[a-zA-Z0-9_-]{10,30}$/.test(raw),
      hint: "<chatId>",
    },
  },
  agentTools: ({ cfg }) => {
    if (!getOpenGramSection(cfg!)?.enabled) return [];
    return [opengramRequestTool, opengramChatTool, opengramMediaTool, opengramSearchTool];
  },
  agentPrompt: {
    messageToolHints: ({ cfg }) => {
      if (!getOpenGramSection(cfg!)?.enabled) return [];
      return [
        "This conversation is via OpenGram. You can create structured Requests " +
          "(choice/text_input/form) using the opengram_request tool instead of asking " +
          "questions in plain text. Requests appear as tappable UI widgets in the mobile app. " +
          "When using OpenGram tools, pass the chatId from the current conversation context.",
      ];
    },
  },
  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 200, idleMs: 300 },
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
  heartbeat: {
    checkReady: async ({ cfg }) => {
      try {
        const section = getOpenGramSection(cfg);
        if (!section?.baseUrl) return { ok: false, reason: "OpenGram not configured" };
        const client = new OpenGramClient(section.baseUrl, section.instanceSecret);
        await client.health();
        return { ok: true, reason: "OpenGram reachable" };
      } catch {
        return { ok: false, reason: "OpenGram unreachable" };
      }
    },
    resolveRecipients: () => ({
      recipients: [...getActiveChatIds()],
      source: "opengram",
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const { cfg, account, abortSignal, log } = ctx;
      const config = account.config;
      const client = new OpenGramClient(config.baseUrl, config.instanceSecret);
      const logger = log ?? { info: () => {}, warn: () => {}, error: () => {} };

      try {
        const health = await client.health();
        logger.info?.(`[opengram] Connected to OpenGram v${health.version} at ${config.baseUrl}`);
      } catch (err) {
        logger.warn?.(`[opengram] OpenGram not reachable at ${config.baseUrl}: ${err}`);
      }

      await initializeChatManager(client, cfg);

      const lifecycle = startInboundListener({
        client,
        cfg,
        abortSignal,
        log: logger,
        reconnectDelayMs: config.reconnectDelayMs,
      });

      logger.info?.("[opengram] Inbound SSE listener started");

      return lifecycle;
    },
  },
};
