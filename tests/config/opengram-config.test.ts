import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadOpengramConfig, OPEN_GRAM_DEFAULT_CONFIG, resetConfigCacheForTests } from "@/src/config/opengram-config";

function writeConfigFile(content: unknown) {
  const tempDir = mkdtempSync(join(tmpdir(), "opengram-config-"));
  const filePath = path.join(tempDir, "opengram.config.json");
  writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

let previousCorsOriginsEnv: string | undefined;

beforeEach(() => {
  previousCorsOriginsEnv = process.env.OPENGRAM_CORS_ORIGINS;
});

afterEach(() => {
  resetConfigCacheForTests();
  if (previousCorsOriginsEnv === undefined) {
    delete process.env.OPENGRAM_CORS_ORIGINS;
  } else {
    process.env.OPENGRAM_CORS_ORIGINS = previousCorsOriginsEnv;
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
    expect(process.env.OPENGRAM_CORS_ORIGINS).toBe("https://app.example.com");
  });

  it("clears OPENGRAM_CORS_ORIGINS when corsOrigins is empty", () => {
    process.env.OPENGRAM_CORS_ORIGINS = "https://stale.example.com";
    const filePath = writeConfigFile({
      server: {
        corsOrigins: [],
      },
    });

    const config = loadOpengramConfig(filePath);
    expect(config.server.corsOrigins).toEqual([]);
    expect(process.env.OPENGRAM_CORS_ORIGINS).toBeUndefined();
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
});
