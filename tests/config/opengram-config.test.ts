import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadOpengramConfig, OPEN_GRAM_DEFAULT_CONFIG } from "@/src/config/opengram-config";

function writeConfigFile(content: unknown) {
  const tempDir = mkdtempSync(join(tmpdir(), "opengram-config-"));
  const filePath = path.join(tempDir, "opengram.config.json");
  writeFileSync(filePath, JSON.stringify(content, null, 2));
  return filePath;
}

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
});
