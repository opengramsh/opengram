import { generateTitle, getProviderById, resolveApiKey } from "./rename-providers.js";
const TITLE_MAX_CHARS = 48;
const MESSAGES_FOR_CONTEXT = 6;
/** Maximum characters to include per message when building context */
const MSG_CONTEXT_MAX_CHARS = 300;
/**
 * Attempt to auto-rename a chat based on conversation content.
 * Fires once per chat (while title_source === 'default') and is fully
 * transparent to the main agent. All errors are caught and logged — the
 * chat is never affected by a rename failure.
 */
export async function maybeAutoRename(params) {
    const { chatId, cfg, client, log } = params;
    try {
        const ar = cfg.autoRename;
        if (!ar?.enabled)
            return;
        if (!ar.provider || !ar.modelId) {
            log?.warn("[opengram:auto-rename] provider or modelId not configured, skipping");
            return;
        }
        // Resolve provider and API key before any network calls (free checks).
        const provider = getProviderById(ar.provider);
        if (!provider) {
            log?.warn(`[opengram:auto-rename] Unknown provider "${ar.provider}", skipping`);
            return;
        }
        const apiKey = resolveApiKey(provider, ar.apiKey);
        if (!apiKey) {
            log?.warn(`[opengram:auto-rename] No API key found for provider "${ar.provider}", skipping`);
            return;
        }
        // Check if this chat still has its default (untouched) title.
        const chat = await client.getChat(chatId);
        if (chat.title_source !== "default")
            return;
        // Fetch recent messages to build context.
        const messages = await client.getMessages(chatId, { limit: MESSAGES_FOR_CONTEXT });
        const userAndAgentMessages = messages.filter((m) => m.role === "user" || m.role === "agent");
        if (userAndAgentMessages.length === 0)
            return;
        const conversationText = userAndAgentMessages
            .map((m) => {
            const role = m.role === "user" ? "User" : "Assistant";
            const text = m.content_final?.trim() ?? "";
            const truncated = text.length > MSG_CONTEXT_MAX_CHARS ? text.slice(0, MSG_CONTEXT_MAX_CHARS) + "…" : text;
            return `${role}: ${truncated}`;
        })
            .join("\n");
        if (!conversationText.trim())
            return;
        // Skip if the user hasn't said enough to produce a meaningful title.
        const userMessageLength = userAndAgentMessages
            .filter((m) => m.role === "user")
            .reduce((sum, m) => {
            const text = m.content_final ?? "";
            return sum + text.trim().length;
        }, 0);
        if (userMessageLength < 30)
            return;
        // Generate the title.
        const rawTitle = await generateTitle({
            provider: ar.provider,
            modelId: ar.modelId,
            apiKey,
            conversationText,
        });
        const title = rawTitle.trim().slice(0, TITLE_MAX_CHARS);
        if (!title) {
            log?.warn("[opengram:auto-rename] Provider returned empty title, skipping");
            return;
        }
        // Update the chat title, marking it as auto-renamed.
        await client.updateChat(chatId, { title, titleAutoRenamed: true });
        log?.info(`[opengram:auto-rename] Renamed chat ${chatId} to "${title}"`);
    }
    catch (err) {
        log?.warn(`[opengram:auto-rename] Failed for chat ${chatId}: ${String(err)}`);
    }
}
