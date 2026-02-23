import { describe, expect, it, vi } from "vitest";

// Mock openclaw/plugin-sdk since buildChannelConfigSchema requires full SDK
vi.mock("openclaw/plugin-sdk", () => ({
  buildChannelConfigSchema: (schema: unknown) => schema,
}));

import { opengramPlugin } from "../src/channel.js";

describe("channel plugin definition", () => {
  describe("plugin object shape", () => {
    it("has the correct id", () => {
      expect(opengramPlugin.id).toBe("opengram");
    });

    it("has required meta fields", () => {
      expect(opengramPlugin.meta).toEqual(
        expect.objectContaining({
          id: "opengram",
          label: "OpenGram",
          selectionLabel: "OpenGram (self-hosted)",
          docsPath: "/channels/opengram",
        }),
      );
    });

    it("includes og as an alias", () => {
      expect(opengramPlugin.meta.aliases).toContain("og");
    });

    it("exposes outbound send functions", () => {
      expect(opengramPlugin.outbound.sendText).toBeTypeOf("function");
      expect(opengramPlugin.outbound.sendMedia).toBeTypeOf("function");
    });

    it("exposes gateway start", () => {
      expect(opengramPlugin.gateway!.startAccount).toBeTypeOf("function");
    });
  });

  describe("capabilities", () => {
    it("supports direct chat type", () => {
      expect(opengramPlugin.capabilities.chatTypes).toContain("direct");
    });

    it("supports media", () => {
      expect(opengramPlugin.capabilities.media).toBe(true);
    });

    it("supports block streaming", () => {
      expect(opengramPlugin.capabilities.blockStreaming).toBe(true);
    });

    it("does not support threads", () => {
      expect(opengramPlugin.capabilities.threads).toBe(false);
    });

    it("does not support reactions", () => {
      expect(opengramPlugin.capabilities.reactions).toBe(false);
    });

    it("does not support polls", () => {
      expect(opengramPlugin.capabilities.polls).toBe(false);
    });

    it("does not support native commands", () => {
      expect(opengramPlugin.capabilities.nativeCommands).toBe(false);
    });
  });

  describe("config adapter", () => {
    it("listAccountIds returns default when enabled", () => {
      const cfg = { channels: { opengram: { enabled: true, baseUrl: "http://localhost:3000" } } };
      expect(opengramPlugin.config.listAccountIds(cfg)).toEqual(["default"]);
    });

    it("listAccountIds returns default when enabled is undefined (default-on)", () => {
      const cfg = { channels: { opengram: { baseUrl: "http://localhost:3000" } } };
      expect(opengramPlugin.config.listAccountIds(cfg)).toEqual(["default"]);
    });

    it("listAccountIds returns empty when disabled", () => {
      const cfg = { channels: { opengram: { enabled: false } } };
      expect(opengramPlugin.config.listAccountIds(cfg)).toEqual([]);
    });

    it("resolveAccount uses default accountId", () => {
      const cfg = {
        channels: {
          opengram: {
            baseUrl: "https://gram.example.com",
            agents: ["grami"],
          },
        },
      };
      const account = opengramPlugin.config.resolveAccount(cfg, "default");
      expect(account.accountId).toBe("default");
      expect(account.config.baseUrl).toBe("https://gram.example.com");
      expect(account.config.agents).toEqual(["grami"]);
    });

    it("resolveAccount falls back when accountId is undefined", () => {
      const cfg = { channels: { opengram: { baseUrl: "http://localhost:3000" } } };
      const account = opengramPlugin.config.resolveAccount(cfg, undefined as any);
      expect(account.accountId).toBe("default");
    });

    it("defaultAccountId returns default", () => {
      expect(opengramPlugin.config.defaultAccountId()).toBe("default");
    });

    it("isConfigured returns true when baseUrl is set", () => {
      const account = {
        accountId: "default",
        enabled: true,
        config: { baseUrl: "https://gram.example.com", agents: [], reconnectDelayMs: 3000 },
      };
      expect(opengramPlugin.config.isConfigured(account)).toBe(true);
    });

    it("isConfigured returns false when baseUrl is empty", () => {
      const account = {
        accountId: "default",
        enabled: true,
        config: { baseUrl: "", agents: [], reconnectDelayMs: 3000 },
      };
      expect(opengramPlugin.config.isConfigured(account)).toBe(false);
    });

    it("isConfigured returns false when baseUrl is whitespace", () => {
      const account = {
        accountId: "default",
        enabled: true,
        config: { baseUrl: "   ", agents: [], reconnectDelayMs: 3000 },
      };
      expect(opengramPlugin.config.isConfigured(account)).toBe(false);
    });

    it("describeAccount includes baseUrl and configured status", () => {
      const account = {
        accountId: "default",
        name: "My OpenGram",
        enabled: true,
        config: { baseUrl: "https://gram.example.com", agents: [], reconnectDelayMs: 3000 },
      };
      const desc = opengramPlugin.config.describeAccount(account);
      expect(desc).toEqual(
        expect.objectContaining({
          accountId: "default",
          name: "My OpenGram",
          enabled: true,
          configured: true,
          baseUrl: "https://gram.example.com",
        }),
      );
    });
  });

  describe("security", () => {
    it("resolves DM policy from account config", () => {
      const account = {
        accountId: "default",
        enabled: true,
        config: {
          baseUrl: "http://localhost:3000",
          agents: [] as string[],
          reconnectDelayMs: 3000,
          dmPolicy: "pairing",
          allowFrom: [] as string[],
        },
      };
      const policy = opengramPlugin.security!.resolveDmPolicy!({ cfg: {} as any, account });
      expect(policy!.policy).toBe("pairing");
    });

    it("defaults to pairing when dmPolicy is not set", () => {
      const account = {
        accountId: "default",
        enabled: true,
        config: {
          baseUrl: "http://localhost:3000",
          agents: [] as string[],
          reconnectDelayMs: 3000,
          dmPolicy: undefined as any,
          allowFrom: [] as string[],
        },
      };
      const policy = opengramPlugin.security!.resolveDmPolicy!({ cfg: {} as any, account });
      expect(policy!.policy).toBe("pairing");
    });
  });

  describe("messaging", () => {
    it("normalizeTarget trims whitespace", () => {
      expect(opengramPlugin.messaging.normalizeTarget("  chat-123  ")).toBe("chat-123");
    });

    it("targetResolver recognizes valid chat IDs", () => {
      expect(opengramPlugin.messaging.targetResolver.looksLikeId("abcdef1234")).toBe(true);
      expect(opengramPlugin.messaging.targetResolver.looksLikeId("chat_id-with-dashes")).toBe(true);
    });

    it("targetResolver rejects short strings", () => {
      expect(opengramPlugin.messaging.targetResolver.looksLikeId("abc")).toBe(false);
    });

    it("targetResolver rejects strings with special chars", () => {
      expect(opengramPlugin.messaging.targetResolver.looksLikeId("chat@id!here")).toBe(false);
    });
  });

  describe("agentTools", () => {
    it("returns tools when opengram is enabled", () => {
      const cfg = { channels: { opengram: { enabled: true, baseUrl: "http://localhost:3000" } } };
      const tools = opengramPlugin.agentTools({ cfg });
      expect(tools).toHaveLength(4);
      const names = tools.map((t: any) => t.name);
      expect(names).toContain("opengram_request");
      expect(names).toContain("opengram_chat");
      expect(names).toContain("opengram_media");
      expect(names).toContain("opengram_search");
    });

    it("returns empty array when opengram is disabled", () => {
      const cfg = { channels: { opengram: { enabled: false } } };
      expect(opengramPlugin.agentTools({ cfg })).toEqual([]);
    });

    it("returns empty array when cfg is undefined", () => {
      expect(opengramPlugin.agentTools({ cfg: undefined as any })).toEqual([]);
    });
  });

  describe("streaming config", () => {
    it("has block streaming coalesce defaults", () => {
      expect(opengramPlugin.streaming.blockStreamingCoalesceDefaults).toEqual({
        minChars: 200,
        idleMs: 300,
      });
    });
  });

  describe("outbound config", () => {
    it("uses direct delivery mode", () => {
      expect(opengramPlugin.outbound.deliveryMode).toBe("direct");
    });

    it("has a high text chunk limit", () => {
      expect(opengramPlugin.outbound.textChunkLimit).toBe(50000);
    });

    it("has null chunker", () => {
      expect(opengramPlugin.outbound.chunker).toBeNull();
    });
  });

  describe("reload config", () => {
    it("watches opengram config prefix", () => {
      expect(opengramPlugin.reload.configPrefixes).toEqual(["channels.opengram"]);
    });
  });

  describe("heartbeat", () => {
    it("resolveRecipients returns active chat IDs", () => {
      const result = opengramPlugin.heartbeat.resolveRecipients();
      expect(result.source).toBe("opengram");
      expect(result.recipients).toBeInstanceOf(Array);
    });
  });

  describe("agentPrompt", () => {
    it("returns hints when opengram is enabled", () => {
      const cfg = { channels: { opengram: { enabled: true } } };
      const hints = opengramPlugin.agentPrompt.messageToolHints({ cfg });
      expect(hints).toHaveLength(1);
      expect(hints[0]).toContain("opengram_request");
    });

    it("returns empty when opengram is disabled", () => {
      const cfg = { channels: { opengram: { enabled: false } } };
      const hints = opengramPlugin.agentPrompt.messageToolHints({ cfg });
      expect(hints).toEqual([]);
    });
  });
});
