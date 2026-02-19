import { Type } from "@sinclair/typebox";

import { getConfig, getOpenGramClient, trackActiveChat } from "../chat-manager.js";
import type { AgentTool } from "../types.js";

export const opengramChatTool: AgentTool = {
  name: "opengram_chat",
  label: "OpenGram Chat",
  description:
    "Manage OpenGram chats — create new chats, update metadata, or list existing chats.",
  parameters: Type.Object({
    action: Type.Union(
      [Type.Literal("create"), Type.Literal("update"), Type.Literal("list")],
      { description: "Action to perform" },
    ),
    chatId: Type.Optional(
      Type.String({ description: "Chat ID (required for update)" }),
    ),
    agentId: Type.Optional(
      Type.String({ description: "Agent ID for new chat (defaults to first configured agent)" }),
    ),
    title: Type.Optional(Type.String({ description: "Chat title" })),
    tags: Type.Optional(Type.Array(Type.String(), { description: "Chat tags" })),
    customState: Type.Optional(Type.String({ description: "Custom state JSON" })),
    pinned: Type.Optional(Type.Boolean({ description: "Pin/unpin the chat" })),
  }),

  async execute(_toolCallId, params) {
    const client = getOpenGramClient();

    switch (params.action) {
      case "create": {
        const cfg = getConfig();
        const agentId =
          params.agentId ?? cfg.channels?.opengram?.agents?.[0] ?? "unknown";
        const modelId = cfg.channels?.opengram?.defaultModelId ?? "unknown";
        const chat = await client.createChat({
          agentIds: [agentId],
          modelId,
          title: params.title,
          tags: params.tags,
        });
        trackActiveChat(chat.id);
        return {
          content: [
            {
              type: "text" as const,
              text: `Chat created: ${chat.id}${params.title ? ` ("${params.title}")` : ""}`,
            },
          ],
          details: chat,
        };
      }
      case "update": {
        if (!params.chatId) {
          return {
            content: [{ type: "text" as const, text: "Error: chatId is required for update" }],
            details: { error: "chatId required" },
          };
        }
        const updated = await client.updateChat(params.chatId, {
          title: params.title,
          tags: params.tags,
          customState: params.customState,
          pinned: params.pinned,
        });
        return {
          content: [{ type: "text" as const, text: `Chat ${params.chatId} updated` }],
          details: updated,
        };
      }
      case "list": {
        const result = await client.listChats({ limit: 20 });
        const summary = result.data
          .map((c) => `- ${c.id}${(c as any).title ? `: ${(c as any).title}` : ""}`)
          .join("\n");
        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${result.data.length} chats:\n${summary}`,
            },
          ],
          details: result,
        };
      }
    }

    return {
      content: [{ type: "text" as const, text: `Unknown action: ${params.action}` }],
      details: { error: "unknown action" },
    };
  },
};
