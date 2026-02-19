import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { middleware } from "@/middleware";

const repoRoot = join(import.meta.dirname, "..", "..");

let previousConfigPath: string | undefined;

function setCorsConfig(corsOrigins: string[]) {
  const baseConfig = JSON.parse(readFileSync(join(repoRoot, "config", "opengram.config.json"), "utf8"));
  const tempDir = mkdtempSync(join(tmpdir(), "opengram-cors-config-"));
  const configPath = join(tempDir, "opengram.config.json");

  baseConfig.server = {
    ...baseConfig.server,
    corsOrigins,
  };

  writeFileSync(configPath, JSON.stringify(baseConfig), "utf8");
  process.env.OPENGRAM_CONFIG_PATH = configPath;
}

function createRequest(url: string, method: string, headers?: Record<string, string>) {
  return new NextRequest(new Request(url, { method, headers }));
}

beforeEach(() => {
  previousConfigPath = process.env.OPENGRAM_CONFIG_PATH;
});

afterEach(() => {
  if (previousConfigPath === undefined) {
    delete process.env.OPENGRAM_CONFIG_PATH;
  } else {
    process.env.OPENGRAM_CONFIG_PATH = previousConfigPath;
  }
});

describe("API CORS middleware", () => {
  it("responds to preflight for allowed origins", () => {
    setCorsConfig(["https://app.example.com"]);

    const response = middleware(
      createRequest("http://localhost/api/v1/chats", "OPTIONS", {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("content-type,authorization");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("adds CORS headers for non-OPTIONS requests from allowed origins", () => {
    setCorsConfig(["https://app.example.com"]);

    const response = middleware(
      createRequest("http://localhost/api/v1/chats", "GET", {
        Origin: "https://app.example.com",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("does not emit CORS headers when origin is not allowed", () => {
    setCorsConfig(["https://allowed.example.com"]);

    const response = middleware(
      createRequest("http://localhost/api/v1/chats", "GET", {
        Origin: "https://app.example.com",
      }),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("defaults to same-origin behavior when corsOrigins is empty", () => {
    setCorsConfig([]);

    const response = middleware(
      createRequest("http://localhost/api/v1/chats", "OPTIONS", {
        Origin: "https://app.example.com",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Headers")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });
});
