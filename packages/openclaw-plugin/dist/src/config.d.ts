import { z } from "zod";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
export declare const OpenGramConfigSchema: z.ZodObject<{
    baseUrl: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    instanceSecret: z.ZodOptional<z.ZodString>;
    agents: z.ZodOptional<z.ZodArray<z.ZodString>>;
    reconnectDelayMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    dmPolicy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    allowFrom: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    showReasoningMessages: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
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
export declare function resolveOpenGramAccount(cfg: OpenClawConfig, accountId?: string): ResolvedOpenGramAccount;
