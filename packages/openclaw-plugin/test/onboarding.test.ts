import { describe, expect, it, vi } from "vitest";

// Mock openclaw/plugin-sdk for channel.ts import chain
vi.mock("openclaw/plugin-sdk", () => ({
  buildChannelConfigSchema: (schema: unknown) => schema,
}));

// Mock the tailscale module
vi.mock("../src/cli/tailscale.js", () => ({
  detectOpengramUrl: vi.fn(() => Promise.resolve("http://localhost:3000")),
}));

// Mock the api-client
vi.mock("../src/api-client.js", () => ({
  OpenGramClient: vi.fn().mockImplementation(() => ({
    health: vi.fn().mockResolvedValue({ status: "ok", version: "1.0.0", uptime: 42 }),
  })),
}));

import { opengramOnboardingAdapter } from "../src/onboarding.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

function makeConfig(opengram?: Record<string, unknown>): OpenClawConfig {
  return {
    channels: opengram ? { opengram } : {},
  } as unknown as OpenClawConfig;
}

describe("opengramOnboardingAdapter", () => {
  it("has channel id opengram", () => {
    expect(opengramOnboardingAdapter.channel).toBe("opengram");
  });

  describe("getStatus", () => {
    it("returns configured=false when no opengram section", async () => {
      const status = await opengramOnboardingAdapter.getStatus({
        cfg: makeConfig(),
        accountOverrides: {},
      });
      expect(status.configured).toBe(false);
      expect(status.statusLines).toContain("Not configured");
    });

    it("returns configured=false when baseUrl is empty", async () => {
      const status = await opengramOnboardingAdapter.getStatus({
        cfg: makeConfig({ baseUrl: "" }),
        accountOverrides: {},
      });
      expect(status.configured).toBe(false);
    });

    it("returns configured=true when baseUrl is set", async () => {
      const status = await opengramOnboardingAdapter.getStatus({
        cfg: makeConfig({ baseUrl: "http://localhost:3000" }),
        accountOverrides: {},
      });
      expect(status.configured).toBe(true);
      expect(status.statusLines).toContain("URL: http://localhost:3000");
    });

    it("includes agents in status lines", async () => {
      const status = await opengramOnboardingAdapter.getStatus({
        cfg: makeConfig({
          baseUrl: "http://localhost:3000",
          agents: ["agent-1", "agent-2"],
        }),
        accountOverrides: {},
      });
      expect(status.statusLines).toContain("Agents: agent-1, agent-2");
    });

    it("includes default model in status lines", async () => {
      const status = await opengramOnboardingAdapter.getStatus({
        cfg: makeConfig({
          baseUrl: "http://localhost:3000",
          defaultModelId: "claude-opus-4-6",
        }),
        accountOverrides: {},
      });
      expect(status.statusLines).toContain("Model: claude-opus-4-6");
    });

    it("returns a selectionHint", async () => {
      const status = await opengramOnboardingAdapter.getStatus({
        cfg: makeConfig(),
        accountOverrides: {},
      });
      expect(status.selectionHint).toBeDefined();
    });
  });

  describe("disable", () => {
    it("sets enabled to false", () => {
      const cfg = makeConfig({ baseUrl: "http://localhost:3000", enabled: true });
      const result = opengramOnboardingAdapter.disable!(cfg);
      expect((result.channels as any).opengram.enabled).toBe(false);
    });

    it("preserves other opengram config", () => {
      const cfg = makeConfig({ baseUrl: "http://localhost:3000", agents: ["a"] });
      const result = opengramOnboardingAdapter.disable!(cfg);
      expect((result.channels as any).opengram.baseUrl).toBe("http://localhost:3000");
      expect((result.channels as any).opengram.agents).toEqual(["a"]);
    });

    it("preserves other channel sections", () => {
      const cfg = {
        channels: {
          opengram: { baseUrl: "http://localhost:3000" },
          discord: { token: "abc" },
        },
      } as unknown as OpenClawConfig;
      const result = opengramOnboardingAdapter.disable!(cfg);
      expect((result.channels as any).discord.token).toBe("abc");
    });
  });
});
