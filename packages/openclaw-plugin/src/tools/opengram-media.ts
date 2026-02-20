import { readFile } from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";
import mime from "mime-types";

import { getOpenGramClient } from "../chat-manager.js";
import type { AgentTool } from "../types.js";

export const opengramMediaTool: AgentTool = {
  name: "opengram_media",
  label: "OpenGram Media",
  description: "Upload a file to an OpenGram chat (images, audio, PDFs, etc.).",
  parameters: Type.Object({
    chatId: Type.String({ description: "The OpenGram chat ID to upload to." }),
    filePath: Type.String({ description: "Local file path to upload" }),
    messageId: Type.Optional(
      Type.String({ description: "Link to an existing message" }),
    ),
  }),

  async execute(_toolCallId, params) {
    const client = getOpenGramClient();

    const resolvedPath = path.resolve(params.filePath);
    const file = await readFile(resolvedPath);
    const filename = path.basename(resolvedPath);
    const contentType = mime.lookup(resolvedPath) || "application/octet-stream";

    const media = await client.uploadMedia(params.chatId, {
      file,
      filename,
      contentType,
      messageId: params.messageId,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Uploaded ${filename} (${contentType}) → media ID: ${media.id}`,
        },
      ],
      details: { mediaId: media.id, url: client.getMediaUrl(media.id) },
    };
  },
};
