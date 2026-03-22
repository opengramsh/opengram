import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  delete process.env.OPENGRAM_INSTANCE_SECRET;
});

describe("openclaw-plugin config", () => {
  it("applies defaults and env secret override", async () => {
    process.env.OPENGRAM_INSTANCE_SECRET = "env-secret";

    const { resolveOpenGramAccount } = await import("../src/config.ts");

    const resolved = resolveOpenGramAccount({
      channels: {
        opengram: {
          baseUrl: "http://example.test",
          instanceSecret: "cfg-secret",
          agents: ["agent-a"],
        },
      },
    });

    expect(resolved.accountId).toBe("default");
    expect(resolved.enabled).toBe(true);
    expect(resolved.config.baseUrl).toBe("http://example.test");
    expect(resolved.config.instanceSecret).toBe("env-secret");
    expect(resolved.config.reconnectDelayMs).toBe(3000);
    expect(resolved.config.agents).toEqual(["agent-a"]);
  });

  it("handles missing section with sane defaults", async () => {
    const { resolveOpenGramAccount } = await import("../src/config.ts");

    const resolved = resolveOpenGramAccount({});

    expect(resolved.config.baseUrl).toBe("http://localhost:3000");
    expect(resolved.config.agents).toEqual([]);
    expect(resolved.config.reconnectDelayMs).toBe(3000);
  });
});
