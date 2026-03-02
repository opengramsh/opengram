import { Type } from "@sinclair/typebox";

import { getOpenGramClient } from "../chat-manager.js";
import type { AgentTool } from "../types.js";

const ChoiceConfig = Type.Object(
  {
    options: Type.Array(
      Type.Object({
        id: Type.String({ description: "Unique option identifier" }),
        label: Type.String({ description: "Display text" }),
        variant: Type.Optional(
          Type.Union([Type.Literal("primary"), Type.Literal("danger"), Type.Literal("default")], {
            description: 'Button style: "primary" = suggested, "danger" = destructive',
          }),
        ),
      }),
      { description: "Choice options (buttons)" },
    ),
    maxSelections: Type.Optional(
      Type.Number({ description: "Max selections allowed (default: 1)" }),
    ),
  },
  { description: "Config for choice requests" },
);

const TextInputConfig = Type.Object(
  {
    placeholder: Type.Optional(Type.String({ description: "Placeholder text for the input" })),
    validation: Type.Optional(
      Type.Object({
        minLength: Type.Optional(Type.Number({ description: "Minimum character length" })),
        maxLength: Type.Optional(Type.Number({ description: "Maximum character length" })),
      }),
    ),
  },
  { description: "Config for text_input requests" },
);

const FormFieldSchema = Type.Object({
  name: Type.String({ description: "Field identifier" }),
  type: Type.Union(
    [
      Type.Literal("text"),
      Type.Literal("textarea"),
      Type.Literal("select"),
      Type.Literal("multiselect"),
    ],
    { description: "Field type" },
  ),
  label: Type.String({ description: "Display label" }),
  required: Type.Optional(Type.Boolean({ description: "Whether the field is required" })),
  options: Type.Optional(
    Type.Array(Type.String(), { description: "Options for select/multiselect fields" }),
  ),
});

const FormConfig = Type.Object(
  {
    fields: Type.Array(FormFieldSchema, { description: "Form fields" }),
    submitLabel: Type.Optional(Type.String({ description: "Custom submit button text" })),
  },
  { description: "Config for form requests" },
);

export const opengramRequestTool: AgentTool = {
  name: "opengram_request",
  label: "OpenGram Request",
  description:
    "Create a structured request in OpenGram that requires user action. " +
    "Use this instead of asking questions in plain text. Requests appear as " +
    "tappable UI widgets in the mobile app. Types: choice (buttons), " +
    "text_input (text field), form (multiple fields). " +
    "The chatId is available from the From field in your conversation context (format: opengram:<chatId>).",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The OpenGram chat ID (extract from the From field: opengram:<chatId>).",
    }),
    type: Type.Union(
      [Type.Literal("choice"), Type.Literal("text_input"), Type.Literal("form")],
      { description: "Request type" },
    ),
    title: Type.String({ description: "Short title for the request" }),
    body: Type.Optional(Type.String({ description: "Optional longer description" })),
    config: Type.Union([ChoiceConfig, TextInputConfig, FormConfig], {
      description:
        "Type-specific config. Must match the chosen type: " +
        "choice → options + maxSelections, " +
        "text_input → placeholder + validation, " +
        "form → fields + submitLabel.",
    }),
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
