import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the tailscale module to avoid running actual tailscale commands
vi.mock("../src/cli/tailscale.js", () => ({
  detectTailscaleUrl: vi.fn(() => undefined),
}));

// Mock the api-client to avoid real network calls
vi.mock("../src/api-client.js", () => {
  return {
    OpenGramClient: class {
      health() {
        return Promise.resolve({ status: "ok", version: "1.0.0", uptime: 42 });
      }
    },
  };
});

import { runSetupWizard, applyOpenGramConfig } from "../src/cli/setup.js";
import { detectTailscaleUrl } from "../src/cli/tailscale.js";
import type { OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockPrompter(overrides?: Partial<WizardPrompter>): WizardPrompter {
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    note: vi.fn(),
    select: vi.fn(),
    multiselect: vi.fn().mockResolvedValue([]),
    text: vi.fn().mockResolvedValue("http://localhost:3000"),
    confirm: vi.fn().mockResolvedValue(false),
    progress: vi.fn(() => ({
      update: vi.fn(),
      stop: vi.fn(),
    })),
    ...overrides,
  };
}

function createMinimalConfig(
  overrides?: Record<string, any>,
): OpenClawConfig {
  return {
    agents: {
      list: [
        { id: "agent-1", name: "Agent One" },
        { id: "agent-2", name: "Agent Two" },
      ],
    },
    channels: {},
    ...overrides,
  } as unknown as OpenClawConfig;
}

// ---------------------------------------------------------------------------
// Tests: applyOpenGramConfig
// ---------------------------------------------------------------------------

describe("applyOpenGramConfig", () => {
  it("sets baseUrl, agents, defaultModelId, and enabled", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "https://gram.example.com",
      agents: ["agent-1"],
      defaultModelId: "claude-opus-4-6",
    });

    const section = (result.channels as any).opengram;
    expect(section.enabled).toBe(true);
    expect(section.baseUrl).toBe("https://gram.example.com");
    expect(section.agents).toEqual(["agent-1"]);
    expect(section.defaultModelId).toBe("claude-opus-4-6");
  });

  it("sets instanceSecret when provided", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      instanceSecret: "my-secret",
      agents: [],
      defaultModelId: "gpt-4",
    });

    const section = (result.channels as any).opengram;
    expect(section.instanceSecret).toBe("my-secret");
  });

  it("removes instanceSecret when not provided", () => {
    const cfg = createMinimalConfig({
      channels: { opengram: { instanceSecret: "old-secret" } },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
      defaultModelId: "gpt-4",
    });

    const section = (result.channels as any).opengram;
    expect(section.instanceSecret).toBeUndefined();
  });

  it("preserves existing channel config sections", () => {
    const cfg = createMinimalConfig({
      channels: { discord: { token: "abc" } },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
      defaultModelId: "gpt-4",
    });

    expect((result.channels as any).discord.token).toBe("abc");
  });

  it("preserves existing opengram fields not set by wizard", () => {
    const cfg = createMinimalConfig({
      channels: { opengram: { reconnectDelayMs: 5000, baseUrl: "old" } },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
      defaultModelId: "gpt-4",
    });

    const section = (result.channels as any).opengram;
    expect(section.reconnectDelayMs).toBe(5000);
    expect(section.baseUrl).toBe("http://localhost:3000");
  });
});

// ---------------------------------------------------------------------------
// Tests: runSetupWizard
// ---------------------------------------------------------------------------

describe("runSetupWizard", () => {
  it("is a function", () => {
    expect(runSetupWizard).toBeTypeOf("function");
  });

  it("runs through the full wizard flow and returns config", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000")   // baseUrl
        .mockResolvedValueOnce("claude-opus-4-6"),        // defaultModelId
      confirm: vi.fn()
        .mockResolvedValueOnce(false)    // instance secret: no
        .mockResolvedValueOnce(false),   // restart: no
      multiselect: vi.fn().mockResolvedValue(["agent-1"]),
    });

    const cfg = createMinimalConfig();
    const result = await runSetupWizard(prompter, cfg);

    expect(result.cfg).toBeDefined();
    expect(result.shouldRestart).toBe(false);

    const section = (result.cfg.channels as any).opengram;
    expect(section.enabled).toBe(true);
    expect(section.baseUrl).toBe("http://localhost:3000");
    expect(section.agents).toEqual(["agent-1"]);
    expect(section.defaultModelId).toBe("claude-opus-4-6");
    expect(section.instanceSecret).toBeUndefined();
  });

  it("includes instanceSecret when user opts in", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000")   // baseUrl
        .mockResolvedValueOnce("s3cr3t")                  // instanceSecret
        .mockResolvedValueOnce("claude-opus-4-6"),        // defaultModelId
      confirm: vi.fn()
        .mockResolvedValueOnce(true)     // instance secret: yes
        .mockResolvedValueOnce(false),   // restart: no
      multiselect: vi.fn().mockResolvedValue([]),
    });

    const cfg = createMinimalConfig();
    const result = await runSetupWizard(prompter, cfg);

    const section = (result.cfg.channels as any).opengram;
    expect(section.instanceSecret).toBe("s3cr3t");
  });

  it("returns shouldRestart true when user confirms", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000")
        .mockResolvedValueOnce("claude-opus-4-6"),
      confirm: vi.fn()
        .mockResolvedValueOnce(false)    // instance secret: no
        .mockResolvedValueOnce(true),    // restart: yes
      multiselect: vi.fn().mockResolvedValue([]),
    });

    const cfg = createMinimalConfig();
    const result = await runSetupWizard(prompter, cfg);
    expect(result.shouldRestart).toBe(true);
  });

  it("calls intro and outro", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000")
        .mockResolvedValueOnce("claude-opus-4-6"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn().mockResolvedValue([]),
    });

    const cfg = createMinimalConfig();
    await runSetupWizard(prompter, cfg);

    expect(prompter.intro).toHaveBeenCalledWith("OpenGram Setup");
    expect(prompter.outro).toHaveBeenCalledWith("OpenGram setup complete.");
  });

  it("skips agent selection when no agents in config", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000")
        .mockResolvedValueOnce("claude-opus-4-6"),
      confirm: vi.fn().mockResolvedValue(false),
    });

    const cfg = { channels: {} } as unknown as OpenClawConfig;
    const result = await runSetupWizard(prompter, cfg);

    // multiselect should NOT have been called
    expect(prompter.multiselect).not.toHaveBeenCalled();
    // note should have been called with the "no agents" message
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("No agents found"),
      "Agents",
    );

    const section = (result.cfg.channels as any).opengram;
    expect(section.agents).toEqual([]);
  });

  it("uses Tailscale URL suggestion when available", async () => {
    vi.mocked(detectTailscaleUrl).mockReturnValue("https://myhost.tail1234.ts.net");

    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("https://myhost.tail1234.ts.net")
        .mockResolvedValueOnce("claude-opus-4-6"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn().mockResolvedValue([]),
    });

    const cfg = createMinimalConfig();
    await runSetupWizard(prompter, cfg);

    // First text call (baseUrl) should have used the tailscale URL as initialValue
    expect(prompter.text).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValue: "https://myhost.tail1234.ts.net",
      }),
    );
  });

  it("strips trailing slash from baseUrl", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000///")
        .mockResolvedValueOnce("claude-opus-4-6"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn().mockResolvedValue([]),
    });

    const cfg = createMinimalConfig();
    const result = await runSetupWizard(prompter, cfg);

    const section = (result.cfg.channels as any).opengram;
    expect(section.baseUrl).toBe("http://localhost:3000");
  });
});
