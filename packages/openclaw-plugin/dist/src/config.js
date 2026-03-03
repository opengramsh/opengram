import { z } from "zod";
export const OpenGramConfigSchema = z.object({
    baseUrl: z.string().optional().default("http://localhost:3000").describe("OpenGram instance URL"),
    instanceSecret: z.string().optional().describe("API auth secret"),
    agents: z.array(z.string()).optional().describe("Linked agent IDs"),
    reconnectDelayMs: z.number().optional().default(3000).describe("SSE reconnect delay (ms)"),
    dmPolicy: z.string().optional().default("pairing").describe("DM policy: open | pairing | allowlist | disabled"),
    allowFrom: z.array(z.string()).optional().default([]).describe("Static allowFrom entries"),
    showReasoningMessages: z.boolean().optional().default(false).describe("Show agent reasoning/thinking messages in chat"),
});
export function resolveOpenGramAccount(cfg, accountId) {
    const section = cfg.channels?.opengram;
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
        },
    };
}
