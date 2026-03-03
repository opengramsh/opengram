import { OpenGramClient } from "./api-client.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
export declare function initializeChatManager(apiClient: OpenGramClient, cfg: OpenClawConfig): Promise<void>;
export declare function getOpenGramClient(): OpenGramClient;
export declare function getConfig(): OpenClawConfig;
export declare function resolveAgentForChat(chatId: string, cfg?: OpenClawConfig, log?: {
    info(msg: string): void;
    warn(msg: string): void;
}): Promise<string>;
export declare function resolveChatIdFromTarget(target: string): string;
export declare function trackActiveChat(chatId: string): void;
export declare function invalidateChatCache(chatId: string): void;
export declare function getActiveChatIds(): Set<string>;
