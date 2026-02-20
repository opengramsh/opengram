import { Type } from "@sinclair/typebox";

import { getOpenGramClient } from "../chat-manager.js";
import type { AgentTool } from "../types.js";

export const opengramRequestTool: AgentTool = {
  name: "opengram_request",
  label: "OpenGram Request",
  description:
    "Create a structured request in OpenGram that requires user action. " +
    "Use this instead of asking questions in plain text. Requests appear as " +
    "tappable UI widgets in the mobile app. Types: choice (buttons), " +
    "text_input (text field), form (multiple fields).",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The OpenGram chat ID to create the request in.",
    }),
    type: Type.Union(
      [Type.Literal("choice"), Type.Literal("text_input"), Type.Literal("form")],
      { description: "Request type" },
    ),
    title: Type.String({ description: "Short title for the request" }),
    body: Type.Optional(Type.String({ description: "Optional longer description" })),
    config: Type.Object(
      {},
      {
        additionalProperties: true,
        description:
          "Type-specific config. Choice: { options: [{id, label, variant?}], maxSelections? }. " +
          "TextInput: { placeholder?, validation?: {minLength?, maxLength?} }. " +
          "Form: { fields: [{name, type, label, required?, options?}], submitLabel? }",
      },
    ),
  }),

  async execute(_toolCallId, params) {
    const client = getOpenGramClient();

    const request = await client.createRequest(params.chatId, {
      type: params.type,
      title: params.title,
      body: params.body,
      config: params.config,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Request created: ${request.id} (type: ${params.type}, title: "${params.title}")`,
        },
      ],
      details: { requestId: request.id, status: (request as any).status },
    };
  },
};
