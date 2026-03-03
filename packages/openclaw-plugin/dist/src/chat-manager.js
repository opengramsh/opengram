let clientRef = null;
let configRef = null;
const chatAgentCache = new Map();
const activeChatIds = new Set();
export async function initializeChatManager(apiClient, cfg) {
    clientRef = apiClient;
    configRef = cfg;
    try {
        const result = await apiClient.listChats({ archived: false, limit: 100 });
        for (const chat of result.data) {
            activeChatIds.add(chat.id);
        }
    }
    catch {
        // Do not fail init if chat list bootstrap fails.
    }
}
export function getOpenGramClient() {
    if (!clientRef) {
        throw new Error("OpenGram client not initialized");
    }
    return clientRef;
}
export function getConfig() {
    if (!configRef) {
        throw new Error("Config not initialized");
    }
    return configRef;
}
export async function resolveAgentForChat(chatId, cfg, log) {
    const cached = chatAgentCache.get(chatId);
    if (cached) {
        return cached;
    }
    try {
        const client = clientRef ?? getOpenGramClient();
        const chat = await client.getChat(chatId);
        const agentId = chat.agent_ids?.[0];
        log?.info(`[opengram] resolveAgentForChat(${chatId}): agent_ids=${JSON.stringify(chat.agent_ids)} → resolved="${agentId ?? "(none)"}"`);
        if (agentId) {
            chatAgentCache.set(chatId, agentId);
            return agentId;
        }
    }
    catch (err) {
        log?.warn(`[opengram] resolveAgentForChat(${chatId}): getChat failed, using config fallback — ${String(err)}`);
    }
    const resolvedCfg = cfg ?? configRef;
    const agents = resolvedCfg?.channels?.opengram?.agents;
    const fallback = agents?.[0] ?? "unknown";
    log?.warn(`[opengram] resolveAgentForChat(${chatId}): no agent found via API, using config fallback "${fallback}"`);
    return fallback;
}
export function stripChannelPrefix(raw) {
    return raw.startsWith("opengram:") ? raw.slice("opengram:".length) : raw;
}
export function resolveChatIdFromTarget(target) {
    return stripChannelPrefix(target);
}
export function trackActiveChat(chatId) {
    activeChatIds.add(chatId);
}
export function invalidateChatCache(chatId) {
    chatAgentCache.delete(chatId);
    activeChatIds.delete(chatId);
}
export function getActiveChatIds() {
    return activeChatIds;
}
