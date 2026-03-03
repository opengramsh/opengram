import type { OpenGramClient } from "./api-client.js";
import type { OpenGramChannelConfig } from "./config.js";
/**
 * Attempt to auto-rename a chat based on conversation content.
 * Fires once per chat (while title_source === 'default') and is fully
 * transparent to the main agent. All errors are caught and logged — the
 * chat is never affected by a rename failure.
 */
export declare function maybeAutoRename(params: {
    chatId: string;
    cfg: OpenGramChannelConfig;
    client: OpenGramClient;
    log?: {
        info(msg: string): void;
        warn(msg: string): void;
        error(msg: string): void;
    };
}): Promise<void>;
