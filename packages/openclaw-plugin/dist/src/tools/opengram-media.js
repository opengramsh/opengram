import { readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import mime from "mime-types";
import { getOpenGramClient, resolveAgentForChat, stripChannelPrefix } from "../chat-manager.js";
export const opengramMediaTool = {
    name: "opengram_media",
    label: "OpenGram Media",
    description: "Upload one or more files to an OpenGram chat (images, audio, PDFs, etc.). " +
        "Automatically creates a visible message in the chat. " +
        "Use filePaths to attach multiple files to a single message.",
    parameters: Type.Object({
        chatId: Type.String({ description: "The OpenGram chat ID (from the From field in your context)." }),
        filePaths: Type.Optional(Type.Array(Type.String(), {
            minItems: 1,
            description: "Array of local file paths to upload. Use MediaPaths from the user's inbound context, " +
                "or any local file paths (e.g., files you generated or downloaded).",
        })),
        filePath: Type.Optional(Type.String({
            description: "Deprecated — use filePaths instead. Single local file path to upload.",
        })),
        messageId: Type.Optional(Type.String({ description: "Link to an existing message. If omitted, a new message is created automatically." })),
        caption: Type.Optional(Type.String({ description: "Optional caption text for the message (defaults to empty)." })),
    }),
    async execute(_toolCallId, params) {
        const client = getOpenGramClient();
        const chatId = stripChannelPrefix(params.chatId);
        // Normalize: support both filePaths (preferred) and filePath (deprecated fallback)
        const paths = params.filePaths ?? (params.filePath ? [params.filePath] : []);
        if (paths.length === 0) {
            throw new Error("Either filePaths or filePath must be provided.");
        }
        let messageId = params.messageId;
        if (!messageId) {
            const agentId = await resolveAgentForChat(chatId);
            const message = await client.createMessage(chatId, {
                role: "agent",
                senderId: agentId,
                content: params.caption ?? "",
            });
            messageId = message.id;
        }
        const results = [];
        for (const filePath of paths) {
            const resolvedPath = path.resolve(filePath);
            const file = await readFile(resolvedPath);
            const filename = path.basename(resolvedPath);
            const contentType = mime.lookup(resolvedPath) || "application/octet-stream";
            const media = await client.uploadMedia(chatId, {
                file,
                filename,
                contentType,
                messageId,
            });
            results.push({ filename, contentType, mediaId: media.id });
        }
        const summary = results.map((r) => `${r.filename} (${r.contentType}) → media ID: ${r.mediaId}`).join("\n");
        return {
            content: [
                {
                    type: "text",
                    text: `Uploaded ${results.length} file(s) to message ${messageId}:\n${summary}`,
                },
            ],
            details: {
                mediaIds: results.map((r) => r.mediaId),
                messageId,
                urls: results.map((r) => client.getMediaUrl(r.mediaId)),
            },
        };
    },
};
