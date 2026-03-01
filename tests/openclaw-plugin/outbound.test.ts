import { describe, expect, it, vi } from "vitest";

describe("openclaw-plugin outbound", () => {
  it("sendText resolves agent and posts message", async () => {
    vi.resetModules();

    const mockClient = {
      createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
      listChats: vi.fn().mockResolvedValue({ data: [] }),
      getChat: vi.fn().mockResolvedValue({ id: "chat-1", agent_ids: ["agent-1"] }),
    } as any;

    const chatManager = await import("../../packages/openclaw-plugin/src/chat-manager.ts");
    await chatManager.initializeChatManager(mockClient, {
      channels: { opengram: { agents: ["fallback-agent"] } },
    });

    const outbound = await import("../../packages/openclaw-plugin/src/outbound.ts");
    const result = await outbound.sendText({ to: "chat-1", text: "hello" });

    expect(mockClient.createMessage).toHaveBeenCalledWith("chat-1", {
      role: "agent",
      senderId: "agent-1",
      content: "hello",
    });
    expect(result).toEqual({ channel: "opengram", messageId: "msg-1" });
  });

  it("sendMedia creates message first and links upload", async () => {
    vi.resetModules();

    const mockClient = {
      createMessage: vi.fn().mockResolvedValue({ id: "msg-2" }),
      uploadMedia: vi.fn().mockResolvedValue({ id: "media-1" }),
      listChats: vi.fn().mockResolvedValue({ data: [] }),
      getChat: vi.fn().mockResolvedValue({ id: "chat-1", agent_ids: ["agent-1"] }),
    } as any;

    const chatManager = await import("../../packages/openclaw-plugin/src/chat-manager.ts");
    await chatManager.initializeChatManager(mockClient, {
      channels: { opengram: { agents: ["fallback-agent"] } },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Buffer.from("img"), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    );

    const outbound = await import("../../packages/openclaw-plugin/src/outbound.ts");
    const result = await outbound.sendMedia({
      to: "chat-1",
      text: "caption",
      mediaUrl: "https://files.example/path/file.png",
    });

    expect(mockClient.createMessage).toHaveBeenCalledWith("chat-1", {
      role: "agent",
      senderId: "agent-1",
      content: "caption",
    });
    expect(mockClient.uploadMedia).toHaveBeenCalledTimes(1);
    expect(mockClient.uploadMedia.mock.calls[0][1].messageId).toBe("msg-2");
    expect(result).toEqual({ channel: "opengram", messageId: "msg-2" });
  });
});
