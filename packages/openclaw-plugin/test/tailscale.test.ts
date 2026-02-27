import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import {
  detectOpengramUrl,
} from "../src/cli/tailscale.js";

// ---------------------------------------------------------------------------
// detectOpengramUrl
// ---------------------------------------------------------------------------

describe("detectOpengramUrl", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.mocked(execSync).mockReset();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns first reachable OpenGram URL by priority", async () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          Self: {
            DNSName: "myhost.ts.net.",
            TailscaleIPs: ["100.1.2.3"],
          },
        }),
      ),
    );

    // Only http://100.1.2.3:3333 responds with opengram service
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "http://100.1.2.3:3333/api/v1/health") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ service: "opengram", status: "ok" }),
        });
      }
      return Promise.reject(new Error("ECONNREFUSED"));
    }) as any;

    const result = await detectOpengramUrl();
    expect(result).toBe("http://100.1.2.3:3333");
  });

  it("rejects non-OpenGram services", async () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          Self: { DNSName: "myhost.ts.net.", TailscaleIPs: [] },
        }),
      ),
    );

    // All respond OK but none with service: "opengram"
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    }) as any;

    const result = await detectOpengramUrl();
    // Falls back to tailscale DNS since nothing was identified as opengram
    expect(result).toBe("https://myhost.ts.net");
  });

  it("falls back to tailscale DNS URL when nothing responds", async () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          Self: { DNSName: "myhost.ts.net.", TailscaleIPs: [] },
        }),
      ),
    );

    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error("ECONNREFUSED"),
    ) as any;

    const result = await detectOpengramUrl();
    expect(result).toBe("https://myhost.ts.net");
  });

  it("falls back to localhost:3000 when no tailscale and nothing responds", async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found");
    });

    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error("ECONNREFUSED"),
    ) as any;

    const result = await detectOpengramUrl();
    expect(result).toBe("http://localhost:3000");
  });

  it("prefers HTTPS DNS over HTTP with port when both respond", async () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          Self: {
            DNSName: "myhost.ts.net.",
            TailscaleIPs: ["100.1.2.3"],
          },
        }),
      ),
    );

    // Everything responds as opengram
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ service: "opengram", status: "ok" }),
    }) as any;

    const result = await detectOpengramUrl();
    expect(result).toBe("https://myhost.ts.net");
  });
});
