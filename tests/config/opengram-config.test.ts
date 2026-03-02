import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadOpengramConfig, OPEN_GRAM_DEFAULT_CONFIG, resetConfigCacheForTests } from "@/src/config/opengram-config";

function writeConfigFile(content: unknown) {
  const tempDir = mkdtempSync(join(tmpdir(), "opengram-config-"));
  const filePath = path.join(tempDir, "opengram.config.json");
  writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

const ENV_KEYS = [
  "OPENGRAM_SERVER_PORT",
  "OPENGRAM_PUBLIC_BASE_URL",
  "OPENGRAM_INSTANCE_SECRET",
  "OPENGRAM_CORS_ORIGINS",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  resetConfigCacheForTests();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("loadOpengramConfig", () => {
  it("returns defaults when config file does not exist", () => {
    const config = loadOpengramConfig("/tmp/non-existent-opengram-config.json");
    expect(config).toEqual(OPEN_GRAM_DEFAULT_CONFIG);
  });

  it("merges partial config with defaults", () => {
    const filePath = writeConfigFile({
      appName: "OpenGram Dev",
      server: {
        port: 3300,
      },
    });

    const config = loadOpengramConfig(filePath);
    expect(config.appName).toBe("OpenGram Dev");
    expect(config.server.port).toBe(3300);
    expect(config.server.streamTimeoutSeconds).toBe(60);
    expect(config.security.readEndpointsRequireInstanceSecret).toBe(false);
  });

  it("supports enabling read endpoint auth in security config", () => {
    const filePath = writeConfigFile({
      security: {
        instanceSecretEnabled: true,
        instanceSecret: "s3cret",
        readEndpointsRequireInstanceSecret: true,
      },
    });

    const config = loadOpengramConfig(filePath);
    expect(config.security.instanceSecretEnabled).toBe(true);
    expect(config.security.readEndpointsRequireInstanceSecret).toBe(true);
  });

  it("rejects invalid defaultModelIdForNewChats", () => {
    const filePath = writeConfigFile({
      models: [
        {
          id: "model-a",
          name: "A",
          description: "A",
        },
      ],
      defaultModelIdForNewChats: "unknown-model",
    });

    expect(() => loadOpengramConfig(filePath)).toThrow(
      /defaultModelIdForNewChats must match one configured model id/,
    );
  });

  it("rejects non-array server.corsOrigins", () => {
    const filePath = writeConfigFile({
      server: {
        corsOrigins: "https://app.example.com",
      },
    });

    expect(() => loadOpengramConfig(filePath)).toThrow(
      /server.corsOrigins must be an array of origins/,
    );
  });

  it("rejects non-string values in server.corsOrigins", () => {
    const filePath = writeConfigFile({
      server: {
        corsOrigins: ["https://app.example.com", 42],
      },
    });

    expect(() => loadOpengramConfig(filePath)).toThrow(
      /server.corsOrigins must be an array of strings/,
    );
  });

  it("normalizes whitespace and trailing slash in server.corsOrigins", () => {
    const filePath = writeConfigFile({
      server: {
        corsOrigins: [" https://app.example.com/ ", "https://app.example.com"],
      },
    });

    const config = loadOpengramConfig(filePath);
    expect(config.server.corsOrigins).toEqual(["https://app.example.com"]);
  });

  it("accepts empty corsOrigins array", () => {
    const filePath = writeConfigFile({
      server: {
        corsOrigins: [],
      },
    });

    const config = loadOpengramConfig(filePath);
    expect(config.server.corsOrigins).toEqual([]);
  });

  it("rejects empty values in server.corsOrigins", () => {
    const filePath = writeConfigFile({
      server: {
        corsOrigins: ["   "],
      },
    });

    expect(() => loadOpengramConfig(filePath)).toThrow(
      /server\.corsOrigins cannot include empty values/,
    );
  });

  it("rejects path/query/hash values in server.corsOrigins", () => {
    const filePath = writeConfigFile({
      server: {
        corsOrigins: ["https://app.example.com/path?foo=1#bar"],
      },
    });

    expect(() => loadOpengramConfig(filePath)).toThrow(
      /server\.corsOrigins entries must be origins only/,
    );
  });

  it("rejects invalid server.dispatch.mode", () => {
    const filePath = writeConfigFile({
      server: {
        dispatch: {
          mode: "unsupported",
        },
      },
    });

    expect(() => loadOpengramConfig(filePath)).toThrow(
      /server\.dispatch\.mode must be one of immediate, sequential, batched_sequential/,
    );
  });

  it("rejects dispatch execution maxConcurrency below minConcurrency", () => {
    const filePath = writeConfigFile({
      server: {
        dispatch: {
          execution: {
            minConcurrency: 5,
            maxConcurrency: 2,
          },
        },
      },
    });

    expect(() => loadOpengramConfig(filePath)).toThrow(
      /server\.dispatch\.execution\.maxConcurrency must be greater than or equal to minConcurrency/,
    );
  });

  it("rejects non-positive dispatch claimManyLimit", () => {
    const filePath = writeConfigFile({
      server: {
        dispatch: {
          claim: {
            claimManyLimit: 0,
          },
        },
      },
    });

    expect(() => loadOpengramConfig(filePath)).toThrow(
      /server\.dispatch\.claim\.claimManyLimit must be at least 1/,
    );
  });

  it("returns cached config on repeated calls with same file", () => {
    const filePath = writeConfigFile({ appName: "Cached" });

    const first = loadOpengramConfig(filePath);
    const second = loadOpengramConfig(filePath);
    expect(first).toBe(second);
  });

  it("invalidates cache when config file changes", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "opengram-config-"));
    const filePath = path.join(tempDir, "opengram.config.json");
    writeFileSync(filePath, JSON.stringify({ appName: "Before" }));

    const before = loadOpengramConfig(filePath);
    expect(before.appName).toBe("Before");

    // Ensure mtime changes — some filesystems have 1s granularity
    const content = JSON.parse(readFileSync(filePath, "utf8"));
    content.appName = "After";
    const futureMs = Date.now() + 2_000;
    writeFileSync(filePath, JSON.stringify(content));
    const { utimesSync } = require("node:fs");
    utimesSync(filePath, futureMs / 1000, futureMs / 1000);

    const after = loadOpengramConfig(filePath);
    expect(after.appName).toBe("After");
    expect(after).not.toBe(before);
  });

  it("caches default config when file does not exist", () => {
    const first = loadOpengramConfig("/tmp/non-existent-opengram-config.json");
    const second = loadOpengramConfig("/tmp/non-existent-opengram-config.json");
    expect(first).toBe(second);
  });

  it("does not share cache across different config paths", () => {
    const filePathA = writeConfigFile({ appName: "A" });
    const filePathB = writeConfigFile({ appName: "B" });

    const configA = loadOpengramConfig(filePathA);
    const configB = loadOpengramConfig(filePathB);
    expect(configA.appName).toBe("A");
    expect(configB.appName).toBe("B");
  });

  it("OPENGRAM_PUBLIC_BASE_URL overrides server.publicBaseUrl", () => {
    process.env.OPENGRAM_PUBLIC_BASE_URL = "https://my-instance.example.com";
    const filePath = writeConfigFile({});

    const config = loadOpengramConfig(filePath);
    expect(config.server.publicBaseUrl).toBe("https://my-instance.example.com");
  });

  it("OPENGRAM_INSTANCE_SECRET overrides security.instanceSecret and enables auth", () => {
    process.env.OPENGRAM_INSTANCE_SECRET = "secret123";
    const filePath = writeConfigFile({});

    const config = loadOpengramConfig(filePath);
    expect(config.security.instanceSecret).toBe("secret123");
    expect(config.security.instanceSecretEnabled).toBe(true);
  });

  it("OPENGRAM_CORS_ORIGINS overrides server.corsOrigins (comma-separated)", () => {
    process.env.OPENGRAM_CORS_ORIGINS = "https://a.example.com, https://b.example.com";
    const filePath = writeConfigFile({});

    const config = loadOpengramConfig(filePath);
    expect(config.server.corsOrigins).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("empty env vars do not override config values", () => {
    process.env.OPENGRAM_PUBLIC_BASE_URL = "";
    process.env.OPENGRAM_INSTANCE_SECRET = "  ";
    const filePath = writeConfigFile({
      server: { publicBaseUrl: "https://from-config.example.com" },
    });

    const config = loadOpengramConfig(filePath);
    expect(config.server.publicBaseUrl).toBe("https://from-config.example.com");
    expect(config.security.instanceSecretEnabled).toBe(false);
  });

  it("undefined env vars do not override config values", () => {
    delete process.env.OPENGRAM_PUBLIC_BASE_URL;
    delete process.env.OPENGRAM_INSTANCE_SECRET;
    delete process.env.OPENGRAM_CORS_ORIGINS;
    const filePath = writeConfigFile({
      server: { publicBaseUrl: "https://from-config.example.com" },
      security: { instanceSecretEnabled: true, instanceSecret: "from-config" },
    });

    const config = loadOpengramConfig(filePath);
    expect(config.server.publicBaseUrl).toBe("https://from-config.example.com");
    expect(config.security.instanceSecret).toBe("from-config");
  });

  it("OPENGRAM_CORS_ORIGINS env var overrides config file corsOrigins", () => {
    process.env.OPENGRAM_CORS_ORIGINS = "https://env.example.com";
    const filePath = writeConfigFile({
      server: { corsOrigins: ["https://config.example.com"] },
    });

    const config = loadOpengramConfig(filePath);
    expect(config.server.corsOrigins).toEqual(["https://env.example.com"]);
  });

  it("invalidates cache when env overrides change", () => {
    const filePath = writeConfigFile({});

    process.env.OPENGRAM_PUBLIC_BASE_URL = "https://first.example.com";
    resetConfigCacheForTests();
    const first = loadOpengramConfig(filePath);
    expect(first.server.publicBaseUrl).toBe("https://first.example.com");

    process.env.OPENGRAM_PUBLIC_BASE_URL = "https://second.example.com";
    const second = loadOpengramConfig(filePath);
    expect(second.server.publicBaseUrl).toBe("https://second.example.com");
    expect(second).not.toBe(first);
  });
});
