import { OpenGramClient } from "./api-client.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

let clientRef: OpenGramClient | null = null;
let configRef: OpenClawConfig | null = null;

const chatAgentCache = new Map<string, string>();
const activeChatIds = new Set<string>();

export async function initializeChatManager(apiClient: OpenGramClient, cfg: OpenClawConfig): Promise<void> {
  clientRef = apiClient;
  configRef = cfg;

  try {
    const result = await apiClient.listChats({ archived: false, limit: 100 });
    for (const chat of result.data) {
      activeChatIds.add(chat.id);
    }
  } catch {
    // Do not fail init if chat list bootstrap fails.
  }
}

export function getOpenGramClient(): OpenGramClient {
  if (!clientRef) {
    throw new Error("OpenGram client not initialized");
  }
  return clientRef;
}

export function getConfig(): OpenClawConfig {
  if (!configRef) {
    throw new Error("Config not initialized");
  }
  return configRef;
}

export async function resolveAgentForChat(chatId: string, cfg?: OpenClawConfig): Promise<string> {
  const cached = chatAgentCache.get(chatId);
  if (cached) {
    return cached;
  }

  try {
    const client = clientRef ?? getOpenGramClient();
    const chat = await client.getChat(chatId);
    const agentId = chat.agent_ids?.[0];
    if (agentId) {
      chatAgentCache.set(chatId, agentId);
      return agentId;
    }
  } catch {
    // Fallback below.
  }

  const resolvedCfg = cfg ?? configRef;
  const agents = (resolvedCfg?.channels as Record<string, any> | undefined)?.opengram?.agents;
  return agents?.[0] ?? "unknown";
}

export function resolveChatIdFromTarget(target: string): string {
  return target;
}

export function trackActiveChat(chatId: string): void {
  activeChatIds.add(chatId);
}

export function invalidateChatCache(chatId: string): void {
  chatAgentCache.delete(chatId);
  activeChatIds.delete(chatId);
}

export function getActiveChatIds(): Set<string> {
  return activeChatIds;
}
