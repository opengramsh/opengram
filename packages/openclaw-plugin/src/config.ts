import { z } from "zod";

import type { OpenClawConfig } from "openclaw/plugin-sdk";

export const OpenGramConfigSchema = z.object({
  baseUrl: z.string().optional().default("http://localhost:3000").describe("OpenGram instance URL"),
  instanceSecret: z.string().optional().describe("API auth secret"),
  agents: z.array(z.string()).optional().describe("Linked agent IDs"),
  reconnectDelayMs: z.number().optional().default(3000).describe("SSE reconnect delay (ms)"),
  dmPolicy: z.string().optional().default("pairing").describe("DM policy: open | pairing | allowlist | disabled"),
  allowFrom: z.array(z.string()).optional().default([]).describe("Static allowFrom entries"),
});

export type OpenGramChannelConfig = z.infer<typeof OpenGramConfigSchema> & {
  agents: string[];
  reconnectDelayMs: number;
  dmPolicy: string;
  allowFrom: string[];
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
    },
  };
}
