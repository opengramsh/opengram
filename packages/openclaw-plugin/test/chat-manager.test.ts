import { describe, expect, it, vi } from "vitest";

import type { OpenGramClient } from "../src/api-client.js";
import {
  getActiveChatIds,
  getConfig,
  getOpenGramClient,
  initializeChatManager,
  invalidateChatCache,
  resolveChatIdFromTarget,
  resolveAgentForChat,
  trackActiveChat,
} from "../src/chat-manager.js";
import type { Chat, ListChatsResponse } from "../src/types.js";

function createMockClient(overrides?: Partial<OpenGramClient>): OpenGramClient {
  return {
    createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
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

// Use unique chat IDs per test to avoid cross-test cache contamination
// (the module-level chatAgentCache in chat-manager.ts persists across tests)
let testCounter = 0;
function uniqueChatId(): string {
  return `chat-cm-${++testCounter}`;
}

describe("chat-manager", () => {
  describe("initializeChatManager", () => {
    it("bootstraps active chat IDs from listChats", async () => {
      const client = createMockClient({
        listChats: vi.fn().mockResolvedValue({
          data: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
          cursor: { hasMore: false },
        } as ListChatsResponse),
      });

      await initializeChatManager(client, baseCfg);

      const ids = getActiveChatIds();
      expect(ids.has("c1")).toBe(true);
      expect(ids.has("c2")).toBe(true);
      expect(ids.has("c3")).toBe(true);
    });

    it("does not fail when listChats throws", async () => {
      const client = createMockClient({
        listChats: vi.fn().mockRejectedValue(new Error("network error")),
      });

      // Should not throw
      await initializeChatManager(client, baseCfg);

      expect(getOpenGramClient()).toBe(client);
    });

    it("stores client and config references", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      expect(getOpenGramClient()).toBe(client);
      expect(getConfig()).toBe(baseCfg);
    });
  });

  describe("getOpenGramClient", () => {
    it("returns the initialized client", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);
      expect(getOpenGramClient()).toBe(client);
    });
  });

  describe("getConfig", () => {
    it("returns the initialized config", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);
      expect(getConfig()).toBe(baseCfg);
    });
  });

  describe("resolveAgentForChat", () => {
    it("fetches agent from chat and caches it", async () => {
      const chatId = uniqueChatId();
      const client = createMockClient({
        getChat: vi.fn().mockResolvedValue({ id: chatId, agent_ids: ["agent-x"] }),
      });
      await initializeChatManager(client, baseCfg);

      const agentId = await resolveAgentForChat(chatId);
      expect(agentId).toBe("agent-x");
      expect(client.getChat).toHaveBeenCalledWith(chatId);

      // Second call should use cache, not call getChat again
      const agentId2 = await resolveAgentForChat(chatId);
      expect(agentId2).toBe("agent-x");
      expect(client.getChat).toHaveBeenCalledTimes(1);
    });

    it("falls back to config agents when getChat fails", async () => {
      const chatId = uniqueChatId();
      const client = createMockClient({
        getChat: vi.fn().mockRejectedValue(new Error("not found")),
      });
      await initializeChatManager(client, baseCfg);

      const agentId = await resolveAgentForChat(chatId);
      expect(agentId).toBe("grami");
    });

    it("falls back to config agents when chat has no agent_ids", async () => {
      const chatId = uniqueChatId();
      const client = createMockClient({
        getChat: vi.fn().mockResolvedValue({ id: chatId }),
      });
      await initializeChatManager(client, baseCfg);

      const agentId = await resolveAgentForChat(chatId);
      expect(agentId).toBe("grami");
    });

    it("falls back to unknown when no config agents available", async () => {
      const chatId = uniqueChatId();
      const client = createMockClient({
        getChat: vi.fn().mockRejectedValue(new Error("not found")),
      });
      await initializeChatManager(client, { channels: { opengram: { enabled: true, baseUrl: "http://localhost" } } });

      const agentId = await resolveAgentForChat(chatId);
      expect(agentId).toBe("unknown");
    });

    it("uses provided cfg parameter for fallback", async () => {
      const chatId = uniqueChatId();
      const client = createMockClient({
        getChat: vi.fn().mockRejectedValue(new Error("not found")),
      });
      await initializeChatManager(client, baseCfg);

      const customCfg = { channels: { opengram: { agents: ["custom-agent"] } } };
      const agentId = await resolveAgentForChat(chatId, customCfg);
      expect(agentId).toBe("custom-agent");
    });
  });

  describe("trackActiveChat", () => {
    it("adds chatId to active set", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      const chatId = uniqueChatId();
      trackActiveChat(chatId);
      expect(getActiveChatIds().has(chatId)).toBe(true);
    });

    it("is idempotent", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      const chatId = uniqueChatId();
      trackActiveChat(chatId);
      trackActiveChat(chatId);
      const ids = [...getActiveChatIds()].filter((id) => id === chatId);
      expect(ids).toHaveLength(1);
    });
  });

  describe("invalidateChatCache", () => {
    it("removes chatId from active chats", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);

      const chatId = uniqueChatId();
      trackActiveChat(chatId);
      expect(getActiveChatIds().has(chatId)).toBe(true);

      invalidateChatCache(chatId);
      expect(getActiveChatIds().has(chatId)).toBe(false);
    });

    it("forces re-fetch on next resolveAgentForChat", async () => {
      const chatId = uniqueChatId();
      const client = createMockClient({
        getChat: vi
          .fn()
          .mockResolvedValueOnce({ id: chatId, agent_ids: ["agent-v1"] })
          .mockResolvedValueOnce({ id: chatId, agent_ids: ["agent-v2"] }),
      });
      await initializeChatManager(client, baseCfg);

      const first = await resolveAgentForChat(chatId);
      expect(first).toBe("agent-v1");

      invalidateChatCache(chatId);

      const second = await resolveAgentForChat(chatId);
      expect(second).toBe("agent-v2");
      expect(client.getChat).toHaveBeenCalledTimes(2);
    });
  });

  describe("getActiveChatIds", () => {
    it("returns a Set", async () => {
      const client = createMockClient();
      await initializeChatManager(client, baseCfg);
      expect(getActiveChatIds()).toBeInstanceOf(Set);
    });
  });

  describe("resolveChatIdFromTarget", () => {
    it("returns the target as-is", () => {
      expect(resolveChatIdFromTarget("chat-123")).toBe("chat-123");
    });
  });
});
