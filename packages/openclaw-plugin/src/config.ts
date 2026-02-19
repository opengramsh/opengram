import { Type, type Static } from "@sinclair/typebox";

import type { OpenClawConfig } from "./types.js";

export const OpenGramConfigSchema = Type.Object({
  baseUrl: Type.String({ description: "OpenGram instance URL" }),
  instanceSecret: Type.Optional(Type.String({ description: "API auth secret" })),
  agents: Type.Optional(Type.Array(Type.String(), { description: "Linked agent IDs" })),
  defaultModelId: Type.Optional(Type.String({ description: "Default model for new chats" })),
  reconnectDelayMs: Type.Optional(
    Type.Number({ description: "SSE reconnect delay (ms)", default: 3000 }),
  ),
});

export type OpenGramChannelConfig = Static<typeof OpenGramConfigSchema> & {
  agents: string[];
  reconnectDelayMs: number;
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
  const section = cfg.channels?.opengram;
  return {
    accountId: accountId ?? "default",
    name: section?.name,
    enabled: section?.enabled !== false,
    config: {
      baseUrl: section?.baseUrl ?? "http://localhost:3000",
      instanceSecret: process.env.OPENGRAM_INSTANCE_SECRET ?? section?.instanceSecret,
      agents: section?.agents ?? [],
      defaultModelId: section?.defaultModelId,
      reconnectDelayMs: section?.reconnectDelayMs ?? 3000,
    },
  };
}
