import { z } from "zod";

import type { OpenClawConfig } from "openclaw/plugin-sdk";

export const AutoRenameConfigSchema = z.object({
  enabled: z.boolean().optional().default(false).describe("Automatically rename new chats based on conversation content"),
  provider: z.enum(["anthropic", "openai", "google", "xai", "openrouter"]).optional().describe("AI provider for title generation"),
  modelId: z.string().optional().describe("Model ID to use for title generation"),
  apiKey: z.string().optional().describe("API key (leave empty to use environment variable)"),
});

export type AutoRenameConfig = z.infer<typeof AutoRenameConfigSchema>;

export const OpenGramConfigSchema = z.object({
  baseUrl: z.string().optional().default("http://localhost:3000").describe("OpenGram instance URL"),
  instanceSecret: z.string().optional().describe("API auth secret"),
  agents: z.array(z.string()).optional().describe("Linked agent IDs"),
  reconnectDelayMs: z.number().optional().default(3000).describe("SSE reconnect delay (ms)"),
  dmPolicy: z.string().optional().default("pairing").describe("DM policy: open | pairing | allowlist | disabled"),
  allowFrom: z.array(z.string()).optional().default([]).describe("Static allowFrom entries"),
  showReasoningMessages: z.boolean().optional().default(false).describe("Show agent reasoning/thinking messages in chat"),
  autoRename: AutoRenameConfigSchema.optional().describe("Automatic chat renaming configuration"),
});

export type OpenGramChannelConfig = z.infer<typeof OpenGramConfigSchema> & {
  agents: string[];
  reconnectDelayMs: number;
  dmPolicy: string;
  allowFrom: string[];
  autoRename?: AutoRenameConfig;
};

export type ResolvedOpenGramAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  config: OpenGramChannelConfig;
};

export function resolveOpenGramAccount(
  cfg: OpenClawConfig,
  accountId?: string,
): ResolvedOpenGramAccount {
  const section = (cfg.channels as Record<string, any> | undefined)?.opengram;
  return {
    accountId: accountId ?? "default",
    name: section?.name,
    enabled: section?.enabled !== false,
    config: {
      baseUrl: section?.baseUrl ?? "http://localhost:3000",
      instanceSecret: process.env.OPENGRAM_INSTANCE_SECRET ?? section?.instanceSecret,
      agents: section?.agents ?? [],
      reconnectDelayMs: section?.reconnectDelayMs ?? 3000,
      dmPolicy: section?.dmPolicy ?? "pairing",
      allowFrom: section?.allowFrom ?? [],
      showReasoningMessages: section?.showReasoningMessages ?? false,
      autoRename: section?.autoRename,
    },
  };
}
