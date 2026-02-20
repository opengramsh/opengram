import { getOpenGramClient, resolveAgentForChat } from "./chat-manager.js";
import { downloadMedia } from "./media.js";

export async function sendText(args: {
  to: string;
  text: string;
}): Promise<{ channel: "opengram"; messageId: string }> {
  const client = getOpenGramClient();
  const chatId = args.to;
  const agentId = await resolveAgentForChat(chatId);

  const message = await client.createMessage(chatId, {
    role: "agent",
    senderId: agentId,
    content: args.text,
  });

  return {
    channel: "opengram",
    messageId: message.id,
  };
}

export async function sendMedia(args: {
  to: string;
  text?: string;
  mediaUrl?: string;
}): Promise<{ channel: "opengram"; messageId: string }> {
  const client = getOpenGramClient();
  const chatId = args.to;
  const agentId = await resolveAgentForChat(chatId);

  const message = await client.createMessage(chatId, {
    role: "agent",
    senderId: agentId,
    content: args.text ?? "",
  });

  if (args.mediaUrl) {
    const { buffer, filename, contentType } = await downloadMedia(args.mediaUrl);
    await client.uploadMedia(chatId, {
      file: buffer,
      filename,
      contentType,
      messageId: message.id,
    });
  }

  return {
    channel: "opengram",
    messageId: message.id,
  };
}
