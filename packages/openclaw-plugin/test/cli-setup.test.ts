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

// Mock global fetch for pushToOpenGram
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal("fetch", mockFetch);

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

  it("sets plugins.entries['opengram'].enabled to true", () => {
    const cfg = createMinimalConfig();
    const result = applyOpenGramConfig(cfg, {
      baseUrl: "http://localhost:3000",
      agents: [],
    });

    const entry = (result as any).plugins.entries["opengram"];
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
    expect(plugins.entries["opengram"].enabled).toBe(true);
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
        .mockResolvedValueOnce(false),   // restart: no
      multiselect: vi.fn()
        .mockResolvedValueOnce(["anthropic/claude-sonnet-4-6"])  // models
        .mockResolvedValueOnce(["agent-1"]),                      // agents
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
        .mockResolvedValueOnce(false),   // restart: no
      multiselect: vi.fn()
        .mockResolvedValueOnce([])  // models
        .mockResolvedValueOnce([]), // agents
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
        .mockResolvedValueOnce([])  // models
        .mockResolvedValueOnce([]), // agents
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
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
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

  it("shows model selection from cfg.agents.defaults.models", async () => {
    const prompter = createMockPrompter({
      text: vi.fn().mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce(["anthropic/claude-sonnet-4-6"])  // models selected
        .mockResolvedValueOnce(["agent-1"]),                      // agents selected
    });

    const cfg = createMinimalConfig();
    await runSetupWizard(prompter, cfg);

    // First multiselect should be models
    const firstMultiselectCall = (prompter.multiselect as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstMultiselectCall.message).toMatch(/model/i);
    expect(firstMultiselectCall.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "anthropic/claude-sonnet-4-6" }),
        expect.objectContaining({ value: "anthropic/claude-opus-4-6" }),
      ]),
    );
  });

  it("imports agents with model from agent.model in openclaw config", async () => {
    const prompter = createMockPrompter({
      text: vi.fn().mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce([])             // no models selected
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

  it("calls PATCH /api/v1/config/admin with selected models", async () => {
    const prompter = createMockPrompter({
      text: vi.fn().mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce(["anthropic/claude-sonnet-4-6"])  // models
        .mockResolvedValueOnce([]),                               // no agents
    });

    const cfg = createMinimalConfig();
    await runSetupWizard(prompter, cfg);

    const fetchCall = mockFetch.mock.calls.find((call) =>
      typeof call[0] === "string" && call[0].includes("/api/v1/config/admin"),
    );
    expect(fetchCall).toBeDefined();
    if (fetchCall) {
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "anthropic/claude-sonnet-4-6" }),
        ]),
      );
    }
  });

  it("skips push when no models and no agents selected", async () => {
    mockFetch.mockClear();

    const prompter = createMockPrompter({
      text: vi.fn().mockResolvedValueOnce("http://localhost:3000"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce([])   // no models
        .mockResolvedValueOnce([]),  // no agents
    });

    const cfg = createMinimalConfig();
    await runSetupWizard(prompter, cfg);

    const adminCall = mockFetch.mock.calls.find((call) =>
      typeof call[0] === "string" && call[0].includes("/api/v1/config/admin"),
    );
    expect(adminCall).toBeUndefined();
  });

  it("uses Tailscale URL suggestion when available", async () => {
    vi.mocked(detectTailscaleUrl).mockReturnValue("https://myhost.tail1234.ts.net");

    const prompter = createMockPrompter({
      text: vi.fn()
        .mockResolvedValueOnce("https://myhost.tail1234.ts.net"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
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
        .mockResolvedValueOnce("http://localhost:3000///"),
      confirm: vi.fn().mockResolvedValue(false),
      multiselect: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    });

    const cfg = createMinimalConfig();
    const result = await runSetupWizard(prompter, cfg);

    const section = (result.cfg.channels as any).opengram;
    expect(section.baseUrl).toBe("http://localhost:3000");
  });
});
