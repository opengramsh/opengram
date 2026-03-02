import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the tailscale module to avoid running actual tailscale commands
vi.mock("../src/cli/tailscale.js", () => ({
  detectOpengramUrl: vi.fn(() => Promise.resolve("http://localhost:3000")),
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

// Mock global fetch for pushToOpenGram
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal("fetch", mockFetch);

import { runSetupWizard, applyOpenGramConfig } from "../src/cli/setup.js";
import { detectOpengramUrl } from "../src/cli/tailscale.js";
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
      defaults: {
        models: {
          "anthropic/claude-sonnet-4-6": { alias: "sonnet" },
          "anthropic/claude-opus-4-6": { alias: "opus" },
        },
      },
      list: [
        { id: "agent-1", name: "Agent One", model: "anthropic/claude-sonnet-4-6" },
        { id: "agent-2", name: "Agent Two", model: "anthropic/claude-opus-4-6" },
      ],
    },
    channels: {},
    ...overrides,
  } as unknown as OpenClawConfig;
}

beforeEach(() => {
  mockFetch.mockResolvedValue({ ok: true });
  vi.mocked(detectOpengramUrl).mockResolvedValue("http://localhost:3000");
});

// ---------------------------------------------------------------------------
// Tests: applyOpenGramConfig
// ---------------------------------------------------------------------------

describe("applyOpenGramConfig", () => {
  it("sets baseUrl, agents, and enabled", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "https://gram.example.com",
      agents: ["agent-1"],
    });

    const section = (result.channels as any).opengram;
    expect(section.enabled).toBe(true);
    expect(section.baseUrl).toBe("https://gram.example.com");
    expect(section.agents).toEqual(["agent-1"]);
  });

  it("sets dmPolicy to pairing", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    const section = (result.channels as any).opengram;
    expect(section.dmPolicy).toBe("pairing");
  });

  it("includes user:primary in allowFrom", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    const section = (result.channels as any).opengram;
    expect(section.allowFrom).toEqual(["user:primary"]);
  });

  it("preserves existing allowFrom entries and adds user:primary", () => {
    const cfg = createMinimalConfig({
      channels: { opengram: { allowFrom: ["custom-user"], baseUrl: "old" } },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    const section = (result.channels as any).opengram;
    expect(section.allowFrom).toEqual(["custom-user", "user:primary"]);
    expect(section.dmPolicy).toBe("pairing");
  });

  it("does not duplicate user:primary if already in allowFrom", () => {
    const cfg = createMinimalConfig({
      channels: { opengram: { allowFrom: ["user:primary"], baseUrl: "old" } },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    const section = (result.channels as any).opengram;
    expect(section.allowFrom).toEqual(["user:primary"]);
  });

  it("does not include defaultModelId", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: ["agent-1"],
    });

    const section = (result.channels as any).opengram;
    expect(section.defaultModelId).toBeUndefined();
  });

  it("removes legacy defaultModelId from existing config", () => {
    const cfg = createMinimalConfig({
      channels: { opengram: { defaultModelId: "old-model", baseUrl: "old" } },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    const section = (result.channels as any).opengram;
    expect(section.defaultModelId).toBeUndefined();
  });

  it("sets instanceSecret when provided", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      instanceSecret: "my-secret",
      agents: [],
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
    });

    expect((result.channels as any).discord.token).toBe("abc");
  });

  it("sets plugins.entries['@opengramsh/openclaw-plugin'].enabled to true", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    const entry = (result as any).plugins.entries["@opengramsh/openclaw-plugin"];
    expect(entry.enabled).toBe(true);
  });

  it("preserves existing plugin entries", () => {
    const cfg = createMinimalConfig({
      plugins: {
        entries: {
          "some-other-plugin": { enabled: true, foo: "bar" },
        },
      },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    const plugins = (result as any).plugins;
    expect(plugins.entries["some-other-plugin"]).toEqual({ enabled: true, foo: "bar" });
    expect(plugins.entries["@opengramsh/openclaw-plugin"].enabled).toBe(true);
  });

  it("adds @opengramsh/openclaw-plugin to plugins.allow", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    expect((result as any).plugins.allow).toContain("@opengramsh/openclaw-plugin");
  });

  it("deduplicates plugins.allow if already present", () => {
    const cfg = createMinimalConfig({
      plugins: {
        allow: ["@opengramsh/openclaw-plugin", "other-plugin"],
      },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    const allow = (result as any).plugins.allow;
    expect(allow.filter((p: string) => p === "@opengramsh/openclaw-plugin")).toHaveLength(1);
    expect(allow).toContain("other-plugin");
  });

  it("preserves existing plugins.allow entries", () => {
    const cfg = createMinimalConfig({
      plugins: {
        allow: ["other-plugin"],
      },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    const allow = (result as any).plugins.allow;
    expect(allow).toEqual(["other-plugin", "@opengramsh/openclaw-plugin"]);
  });

  it("adds pluginDir to plugins.load.paths", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
      pluginDir: "/path/to/plugin",
    });

    expect((result as any).plugins.load.paths).toContain("/path/to/plugin");
  });

  it("deduplicates plugins.load.paths if already present", () => {
    const cfg = createMinimalConfig({
      plugins: {
        load: { paths: ["/path/to/plugin"] },
      },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
      pluginDir: "/path/to/plugin",
    });

    const paths = (result as any).plugins.load.paths;
    expect(paths.filter((p: string) => p === "/path/to/plugin")).toHaveLength(1);
  });

  it("preserves existing plugins.load.paths entries", () => {
    const cfg = createMinimalConfig({
      plugins: {
        load: { paths: ["/existing/path"] },
      },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
      pluginDir: "/path/to/plugin",
    });

    const paths = (result as any).plugins.load.paths;
    expect(paths).toEqual(["/existing/path", "/path/to/plugin"]);
  });

  it("keeps plugins.load.paths empty when no pluginDir provided", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    expect((result as any).plugins.load.paths).toEqual([]);
  });

  it("sets session.reset to daily at 4 AM when no existing reset", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    expect((result as any).session.reset).toEqual({ mode: "daily", atHour: 4 });
  });

  it("preserves existing session.reset if already configured", () => {
    const cfg = createMinimalConfig({
      session: { reset: { mode: "idle", idleMinutes: 30 } },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    expect((result as any).session.reset).toEqual({ mode: "idle", idleMinutes: 30 });
  });

  it("sets session.resetByChannel.opengram to idle with ~100-year timeout when not set", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    expect((result as any).session.resetByChannel.opengram).toEqual({
      mode: "idle",
      idleMinutes: 52560000,
    });
  });

  it("preserves existing resetByChannel entries for other channels", () => {
    const cfg = createMinimalConfig({
      session: {
        resetByChannel: {
          discord: { mode: "daily", atHour: 6 },
        },
      },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    expect((result as any).session.resetByChannel.discord).toEqual({
      mode: "daily",
      atHour: 6,
    });
    expect((result as any).session.resetByChannel.opengram).toEqual({
      mode: "idle",
      idleMinutes: 52560000,
    });
  });

  it("preserves existing resetByChannel.opengram if already configured", () => {
    const cfg = createMinimalConfig({
      session: {
        resetByChannel: {
          opengram: { mode: "daily", atHour: 2 },
        },
      },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    expect((result as any).session.resetByChannel.opengram).toEqual({
      mode: "daily",
      atHour: 2,
    });
  });

  it("preserves existing opengram fields not set by wizard", () => {
    const cfg = createMinimalConfig({
      channels: { opengram: { reconnectDelayMs: 5000, baseUrl: "old" } },
    });
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
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
        .mockResolvedValueOnce("http://localhost:3000"),  // baseUrl
      confirm: vi.fn()
        .mockResolvedValueOnce(false)    // instance secret: no
        .mockResolvedValueOnce(false)    // auto-rename: no
        .mockResolvedValueOnce(false),   // restart: no
      multiselect: vi.fn()
        .mockResolvedValueOnce(["agent-1"]),              // agents
    });

    const cfg = createMinimalConfig();
    const result = await runSetupWizard(prompter, cfg);

    expect(result.cfg).toBeDefined();
    expect(result.shouldRestart).toBe(false);

    const section = (result.cfg.channels as any).opengram;
    expect(section.enabled).toBe(true);
    expect(section.baseUrl).toBe("http://localhost:3000");
    expect(section.agents).toEqual(["agent-1"]);
    expect(section.defaultModelId).toBeUndefined();
    expect(section.instanceSecret).toBeUndefined();
  });

  it("includes instanceSecret when user opts in", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000")   // baseUrl
        .mockResolvedValueOnce("s3cr3t"),                  // instanceSecret
      confirm: vi.fn()
        .mockResolvedValueOnce(true)     // instance secret: yes
        .mockResolvedValueOnce(false)    // auto-rename: no
        .mockResolvedValueOnce(false),   // restart: no
      multiselect: vi.fn()
        .mockResolvedValueOnce([]),      // agents
    });

    const cfg = createMinimalConfig();
    const result = await runSetupWizard(prompter, cfg);

    const section = (result.cfg.channels as any).opengram;
    expect(section.instanceSecret).toBe("s3cr3t");
  });

  it("returns shouldRestart true when user confirms", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn()
        .mockResolvedValueOnce(false)    // instance secret: no
        .mockResolvedValueOnce(true),    // restart: yes
      multiselect: vi.fn()
        .mockResolvedValueOnce([]),      // agents
    });

    const cfg = createMinimalConfig();
    const result = await runSetupWizard(prompter, cfg);
    expect(result.shouldRestart).toBe(true);
  });

  it("calls intro and outro", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce([]),  // agents
    });

    const cfg = createMinimalConfig();
    await runSetupWizard(prompter, cfg);

    expect(prompter.intro).toHaveBeenCalledWith("OpenGram Setup");
    expect(prompter.outro).toHaveBeenCalledWith("OpenGram setup complete.");
  });

  it("skips agent selection when no agents in config", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
    });

    const cfg = { channels: {} } as unknown as OpenClawConfig;
    const result = await runSetupWizard(prompter, cfg);

    // note should have been called with the "no agents" message
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("No agents found"),
      "Agents",
    );

    const section = (result.cfg.channels as any).opengram;
    expect(section.agents).toEqual([]);
  });

  it("imports agents with model from agent.model in openclaw config", async () => {
    const prompter = createMockPrompter({
      text: vi.fn().mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce(["agent-1"]),   // agent-1 selected
    });

    const cfg = createMinimalConfig();
    await runSetupWizard(prompter, cfg);

    const fetchCall = mockFetch.mock.calls.find((call) =>
      typeof call[0] === "string" && call[0].includes("/api/v1/config/admin"),
    );
    expect(fetchCall).toBeDefined();
    if (fetchCall) {
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "agent-1",
            defaultModelId: "anthropic/claude-sonnet-4-6",
          }),
        ]),
      );
    }
  });

  it("skips push when no agents selected", async () => {
    mockFetch.mockClear();

    const prompter = createMockPrompter({
      text: vi.fn().mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce([]),  // no agents
    });

    const cfg = createMinimalConfig();
    await runSetupWizard(prompter, cfg);

    const adminCall = mockFetch.mock.calls.find((call) =>
      typeof call[0] === "string" && call[0].includes("/api/v1/config/admin"),
    );
    expect(adminCall).toBeUndefined();
  });

  it("uses auto-detected URL when no existing config", async () => {
    vi.mocked(detectOpengramUrl).mockResolvedValue("http://100.1.2.3:3333");

    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://100.1.2.3:3333"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce([]),  // agents
    });

    const cfg = createMinimalConfig();
    await runSetupWizard(prompter, cfg);

    expect(prompter.text).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValue: "http://100.1.2.3:3333",
      }),
    );
  });

  it("strips trailing slash from baseUrl", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000///"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce([]),  // agents
    });

    const cfg = createMinimalConfig();
    const result = await runSetupWizard(prompter, cfg);

    const section = (result.cfg.channels as any).opengram;
    expect(section.baseUrl).toBe("http://localhost:3000");
  });
});

// ---------------------------------------------------------------------------
// Tests: pre-populating from existing config
// ---------------------------------------------------------------------------

describe("pre-populating from existing config", () => {
  it("uses existing baseUrl as initial value when re-running setup", async () => {
    vi.mocked(detectOpengramUrl).mockClear();

    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://myhost:3333"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce([]),  // agents
    });

    const cfg = createMinimalConfig({
      channels: {
        opengram: {
          enabled: true,
          baseUrl: "http://myhost:3333",
          agents: ["agent-1"],
        },
      },
    });

    await runSetupWizard(prompter, cfg);

    // URL prompt should have the existing URL as initialValue
    expect(prompter.text).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValue: "http://myhost:3333",
      }),
    );

    // Auto-detection should NOT have been called
    expect(detectOpengramUrl).not.toHaveBeenCalled();
  });

  it("pre-selects instance secret confirm when existing secret is set", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000")
        .mockResolvedValueOnce("existing-secret"),
      confirm: vi.fn()
        .mockResolvedValueOnce(true)     // instance secret: yes (pre-selected)
        .mockResolvedValueOnce(false)    // auto-rename: no
        .mockResolvedValueOnce(false),   // restart: no
      multiselect: vi.fn()
        .mockResolvedValueOnce([]),      // agents
    });

    const cfg = createMinimalConfig({
      channels: {
        opengram: {
          enabled: true,
          baseUrl: "http://localhost:3000",
          instanceSecret: "existing-secret",
          agents: [],
        },
      },
    });

    await runSetupWizard(prompter, cfg);

    // First confirm (instance secret) should default to true
    const confirmCalls = (prompter.confirm as ReturnType<typeof vi.fn>).mock.calls;
    expect(confirmCalls[0][0]).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("instance secret"),
        initialValue: true,
      }),
    );

    // Secret text prompt should have existing value as initialValue
    const textCalls = (prompter.text as ReturnType<typeof vi.fn>).mock.calls;
    const secretCall = textCalls.find(
      (call: any) => call[0].message === "Instance secret",
    );
    expect(secretCall?.[0]).toEqual(
      expect.objectContaining({
        initialValue: "existing-secret",
      }),
    );
  });

  it("pre-selects previously configured agents instead of all", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce(["agent-1"]),  // agents
    });

    const cfg = createMinimalConfig({
      channels: {
        opengram: {
          enabled: true,
          baseUrl: "http://localhost:3000",
          agents: ["agent-1"],
        },
      },
    });

    await runSetupWizard(prompter, cfg);

    // Agent multiselect should have only agent-1 pre-selected
    const multiselectCalls = (prompter.multiselect as ReturnType<typeof vi.fn>).mock.calls;
    const agentCall = multiselectCalls.find(
      (call: any) => call[0].message.match(/agent/i),
    );
    expect(agentCall?.[0].initialValues).toEqual(["agent-1"]);
  });

  it("selects all agents when previous agents list is empty", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce(["agent-1", "agent-2"]),  // agents
    });

    const cfg = createMinimalConfig({
      channels: {
        opengram: {
          enabled: true,
          baseUrl: "http://localhost:3000",
          agents: [],
        },
      },
    });

    await runSetupWizard(prompter, cfg);

    const multiselectCalls = (prompter.multiselect as ReturnType<typeof vi.fn>).mock.calls;
    const agentCall = multiselectCalls.find(
      (call: any) => call[0].message.match(/agent/i),
    );
    expect(agentCall?.[0].initialValues).toEqual(["agent-1", "agent-2"]);
  });

  it("filters out previously configured agents that no longer exist", async () => {
    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce(["agent-1"]),  // agents
    });

    const cfg = createMinimalConfig({
      channels: {
        opengram: {
          enabled: true,
          baseUrl: "http://localhost:3000",
          agents: ["agent-1", "deleted-agent"],
        },
      },
    });

    await runSetupWizard(prompter, cfg);

    const multiselectCalls = (prompter.multiselect as ReturnType<typeof vi.fn>).mock.calls;
    const agentCall = multiselectCalls.find(
      (call: any) => call[0].message.match(/agent/i),
    );
    // Only agent-1 should be pre-selected (deleted-agent filtered out)
    expect(agentCall?.[0].initialValues).toEqual(["agent-1"]);
  });
});
