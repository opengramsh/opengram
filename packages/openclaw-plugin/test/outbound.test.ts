import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenGramClient } from "../src/api-client.js";
import { initializeChatManager } from "../src/chat-manager.js";
import { sendMedia, sendText } from "../src/outbound.js";
import type { Chat, ListChatsResponse } from "../src/types.js";

function createMockClient(overrides?: Partial<OpenGramClient>): OpenGramClient {
  return {
    createMessage: vi.fn().mockResolvedValue({ id: "msg-out-1" }),
    sendChunk: vi.fn().mockResolvedValue(undefined),
    completeMessage: vi.fn().mockResolvedValue(undefined),
    cancelMessage: vi.fn().mockResolvedValue(undefined),
    getChat: vi.fn().mockResolvedValue({ id: "chat-1", agent_ids: ["grami"] } as Chat),
    listChats: vi.fn().mockResolvedValue({ data: [], cursor: { hasMore: false } } as ListChatsResponse),
    connectSSE: vi.fn(),
    health: vi.fn().mockResolvedValue({ status: "ok", version: "1.0.0", uptime: 100 }),
    uploadMedia: vi.fn().mockResolvedValue({ id: "media-1" }),
    ...overrides,
  } as unknown as OpenGramClient;
}

const baseCfg = {
  channels: {
    opengram: {
      enabled: true,
      baseUrl: "http://localhost:3000",
      agents: ["grami"],
    },
  },
};

describe("outbound", () => {
  let client: OpenGramClient;

  beforeEach(async () => {
    client = createMockClient();
    await initializeChatManager(client, baseCfg);
  });

  describe("sendText", () => {
    it("creates an agent message with the correct payload", async () => {
      const result = await sendText({ to: "chat-1", text: "Hello user!" });

      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        content: "Hello user!",
      });
      expect(result).toEqual({ channel: "opengram", messageId: "msg-out-1" });
    });

    it("resolves agent from chat when not cached", async () => {
      (client.getChat as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "chat-new",
        agent_ids: ["agent-x"],
      });

      const result = await sendText({ to: "chat-new", text: "Hi" });

      expect(client.getChat).toHaveBeenCalledWith("chat-new");
      expect(client.createMessage).toHaveBeenCalledWith("chat-new", {
        role: "agent",
        senderId: "agent-x",
        content: "Hi",
      });
      expect(result.channel).toBe("opengram");
    });

    it("falls back to config agent when getChat fails", async () => {
      (client.getChat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));

      const result = await sendText({ to: "chat-unknown", text: "Hello" });

      expect(client.createMessage).toHaveBeenCalledWith("chat-unknown", {
        role: "agent",
        senderId: "grami",
        content: "Hello",
      });
      expect(result.messageId).toBe("msg-out-1");
    });
  });

  describe("sendMedia", () => {
    it("creates a message and uploads media when mediaUrl is provided", async () => {
      // Mock downloadMedia by mocking global fetch
      const mockBuffer = Buffer.from("fake-image-data");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(mockBuffer, {
          headers: { "content-type": "image/png" },
        }),
      );

      const result = await sendMedia({
        to: "chat-1",
        text: "Here's an image",
        mediaUrl: "https://example.com/photo.png",
      });

      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        content: "Here's an image",
      });
      expect(client.uploadMedia).toHaveBeenCalledWith("chat-1", {
        file: expect.any(Buffer),
        filename: "photo.png",
        contentType: "image/png",
        messageId: "msg-out-1",
      });
      expect(result).toEqual({ channel: "opengram", messageId: "msg-out-1" });

      vi.restoreAllMocks();
    });

    it("creates a message without upload when no mediaUrl", async () => {
      const result = await sendMedia({
        to: "chat-1",
        text: "Just text, no media",
      });

      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        content: "Just text, no media",
      });
      expect(client.uploadMedia).not.toHaveBeenCalled();
      expect(result).toEqual({ channel: "opengram", messageId: "msg-out-1" });
    });

    it("uses empty string content when text is undefined", async () => {
      const result = await sendMedia({ to: "chat-1" });

      expect(client.createMessage).toHaveBeenCalledWith("chat-1", {
        role: "agent",
        senderId: "grami",
        content: "",
      });
      expect(result.channel).toBe("opengram");
    });
  });
});
