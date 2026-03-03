import { readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import mime from "mime-types";
import { getOpenGramClient } from "../chat-manager.js";
export const opengramMediaTool = {
    name: "opengram_media",
    label: "OpenGram Media",
    description: "Upload a file to an OpenGram chat (images, audio, PDFs, etc.). " +
        "The chatId is available from the From field in your conversation context (format: opengram:<chatId>). " +
        "The filePath can be a MediaPath from a user's inbound message or any local file you generated.",
    parameters: Type.Object({
        chatId: Type.String({ description: "The OpenGram chat ID (extract from the From field: opengram:<chatId>)." }),
        filePath: Type.String({
            description: "Local file path to upload. Use a MediaPath from the user's inbound context, " +
                "or any local file path (e.g., a file you generated or downloaded).",
        }),
        messageId: Type.Optional(Type.String({ description: "Link to an existing message" })),
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
                    type: "text",
                    text: `Uploaded ${filename} (${contentType}) → media ID: ${media.id}`,
                },
            ],
            details: { mediaId: media.id, url: client.getMediaUrl(media.id) },
        };
    },
};
