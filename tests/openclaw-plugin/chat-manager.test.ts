import { describe, expect, it, vi } from "vitest";

describe("openclaw-plugin chat manager", () => {
  it("initializes active chat ids from listChats", async () => {
    vi.resetModules();
    const chatManager = await import("../../packages/openclaw-plugin/src/chat-manager.ts");

    const mockClient = {
      listChats: vi.fn().mockResolvedValue({ data: [{ id: "chat-1" }, { id: "chat-2" }] }),
      getChat: vi.fn(),
    } as any;

    await chatManager.initializeChatManager(mockClient, {
      channels: { opengram: { agents: ["agent-fallback"] } },
    });

    expect([...chatManager.getActiveChatIds()].sort()).toEqual(["chat-1", "chat-2"]);
  });

  it("resolves and caches agent for chat", async () => {
    vi.resetModules();
    const chatManager = await import("../../packages/openclaw-plugin/src/chat-manager.ts");

    const mockClient = {
      listChats: vi.fn().mockResolvedValue({ data: [] }),
      getChat: vi.fn().mockResolvedValue({ id: "chat-1", agent_ids: ["agent-1"] }),
    } as any;

    await chatManager.initializeChatManager(mockClient, {
      channels: { opengram: { agents: ["agent-fallback"] } },
    });

    await expect(chatManager.resolveAgentForChat("chat-1")).resolves.toBe("agent-1");
    await expect(chatManager.resolveAgentForChat("chat-1")).resolves.toBe("agent-1");
    expect(mockClient.getChat).toHaveBeenCalledTimes(1);
  });

  it("falls back to configured agent when chat lookup fails", async () => {
    vi.resetModules();
    const chatManager = await import("../../packages/openclaw-plugin/src/chat-manager.ts");

    const mockClient = {
      listChats: vi.fn().mockResolvedValue({ data: [] }),
      getChat: vi.fn().mockRejectedValue(new Error("boom")),
    } as any;

    await chatManager.initializeChatManager(mockClient, {
      channels: { opengram: { agents: ["agent-fallback"] } },
    });

    await expect(chatManager.resolveAgentForChat("chat-x")).resolves.toBe("agent-fallback");
  });
});
