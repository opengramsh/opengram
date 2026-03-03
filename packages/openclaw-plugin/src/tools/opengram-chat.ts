import { Type } from "@sinclair/typebox";

import { getConfig, getOpenGramClient, stripChannelPrefix, trackActiveChat } from "../chat-manager.js";
import type { AgentTool } from "../types.js";

export const opengramChatTool: AgentTool = {
  name: "opengram_chat",
  label: "OpenGram Chat",
  description:
    "Manage OpenGram chats — create new chats, update metadata, or list existing chats. " +
    "Creating a chat requires modelId — the tool will error without it.",
  parameters: Type.Object({
    action: Type.Union(
      [Type.Literal("create"), Type.Literal("update"), Type.Literal("list")],
      { description: "Action to perform" },
    ),
    chatId: Type.Optional(
      Type.String({ description: "Chat ID (required for update; from the From field in your context)." }),
    ),
    agentId: Type.Optional(
      Type.String({ description: "Agent ID for new chat (defaults to first configured agent)" }),
    ),
    modelId: Type.Optional(
      Type.String({ description: "Model ID — REQUIRED for create. The tool will error without it." }),
    ),
    title: Type.Optional(Type.String({ description: "Chat title" })),
    tags: Type.Optional(Type.Array(Type.String(), { description: "Chat tags" })),
    pinned: Type.Optional(Type.Boolean({ description: "Pin/unpin the chat" })),
  }),

  async execute(_toolCallId, params) {
    const client = getOpenGramClient();

    switch (params.action) {
      case "create": {
        const cfg = getConfig();
        const agentId =
          params.agentId ?? cfg.channels?.opengram?.agents?.[0] ?? "unknown";
        const modelId = params.modelId;
        if (!modelId) {
          return {
            content: [{ type: "text" as const, text: "Error: modelId is required (no default model configured). Provide the modelId parameter." }],
            details: { error: "modelId required" },
          };
        }
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
        const chatId = stripChannelPrefix(params.chatId);
        const updated = await client.updateChat(chatId, {
          title: params.title,
          tags: params.tags,
          pinned: params.pinned,
        });
        return {
          content: [{ type: "text" as const, text: `Chat ${chatId} updated` }],
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
