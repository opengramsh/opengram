import { Type } from "@sinclair/typebox";
import { getOpenGramClient } from "../chat-manager.js";
export const opengramSearchTool = {
    name: "opengram_search",
    label: "OpenGram Search",
    description: "Search past OpenGram conversations by title or message content. " +
        "Returns matching chats (with IDs and titles) and matching messages (with content snippets). " +
        "Use scope to narrow results to just titles or just messages.",
    parameters: Type.Object({
        query: Type.String({ description: "Search text to look for in past conversations" }),
        scope: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("titles"), Type.Literal("messages")], { description: "Search scope (default: all)" })),
    }),
    async execute(_toolCallId, params) {
        const client = getOpenGramClient();
        const result = await client.search(params.query, params.scope ?? "all");
        const chatCount = result.chats?.length ?? 0;
        const msgCount = result.messages?.length ?? 0;
        return {
            content: [
                {
                    type: "text",
                    text: `Search for "${params.query}": ${chatCount} chats, ${msgCount} messages found`,
                },
            ],
            details: result,
        };
    },
};
