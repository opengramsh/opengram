import { Type } from "@sinclair/typebox";

import { getOpenGramClient } from "../chat-manager.js";
import type { AgentTool } from "../types.js";

export const opengramSearchTool: AgentTool = {
  name: "opengram_search",
  label: "OpenGram Search",
  description: "Search past OpenGram conversations by title or message content.",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    scope: Type.Optional(
      Type.Union(
        [Type.Literal("all"), Type.Literal("titles"), Type.Literal("messages")],
        { description: "Search scope (default: all)" },
      ),
    ),
  }),

  async execute(_toolCallId, params) {
    const client = getOpenGramClient();
    const result = await client.search(params.query, params.scope ?? "all");
    const chatCount = result.chats?.length ?? 0;
    const msgCount = result.messages?.length ?? 0;

    return {
      content: [
        {
          type: "text" as const,
          text: `Search for "${params.query}": ${chatCount} chats, ${msgCount} messages found`,
        },
      ],
      details: result,
    };
  },
};
