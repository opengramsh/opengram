import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import {
  detectTailscaleUrl,
  detectOpengramUrl,
  getTailscaleInfo,
  buildCandidateUrls,
} from "../src/cli/tailscale.js";

// ---------------------------------------------------------------------------
// detectTailscaleUrl (legacy, kept for backward compat)
// ---------------------------------------------------------------------------

describe("detectTailscaleUrl", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it("returns undefined when tailscale is not installed", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("tailscale: command not found");
    });

    expect(detectTailscaleUrl()).toBeUndefined();
  });

  it("returns https URL with MagicDNS hostname", () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          Self: {
            DNSName: "myhost.tail1234.ts.net.",
          },
        }),
      ),
    );

    expect(detectTailscaleUrl()).toBe("https://myhost.tail1234.ts.net");
  });

  it("strips trailing dot from DNSName", () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          Self: {
            DNSName: "machine.tailnet-name.ts.net.",
          },
        }),
      ),
    );

    expect(detectTailscaleUrl()).toBe("https://machine.tailnet-name.ts.net");
  });

  it("returns undefined when DNSName is empty", () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          Self: {
            DNSName: "",
          },
        }),
      ),
    );

    expect(detectTailscaleUrl()).toBeUndefined();
  });

  it("returns undefined when Self is missing", () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(JSON.stringify({})),
    );

    expect(detectTailscaleUrl()).toBeUndefined();
  });

  it("returns undefined on invalid JSON", () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from("not json"));

    expect(detectTailscaleUrl()).toBeUndefined();
  });

  it("returns undefined when command times out", () => {
    vi.mocked(execSync).mockImplementation(() => {
      const err = new Error("TIMEOUT");
      (err as any).killed = true;
      throw err;
    });

    expect(detectTailscaleUrl()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getTailscaleInfo
// ---------------------------------------------------------------------------

describe("getTailscaleInfo", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it("returns dnsName and tailscaleIPs when available", () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          Self: {
            DNSName: "myhost.tail1234.ts.net.",
            TailscaleIPs: ["100.112.159.85", "fd7a:115c:a1e0::1"],
          },
        }),
      ),
    );

    expect(getTailscaleInfo()).toEqual({
      dnsName: "myhost.tail1234.ts.net",
      tailscaleIPs: ["100.112.159.85", "fd7a:115c:a1e0::1"],
    });
  });

  it("returns undefined when tailscale is not installed", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found");
    });

    expect(getTailscaleInfo()).toBeUndefined();
  });

  it("strips trailing dot from DNSName", () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          Self: { DNSName: "host.net.", TailscaleIPs: [] },
        }),
      ),
    );

    expect(getTailscaleInfo()?.dnsName).toBe("host.net");
  });

  it("returns undefined when Self has no DNS and no IPs", () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({ Self: { DNSName: "", TailscaleIPs: [] } }),
      ),
    );

    expect(getTailscaleInfo()).toBeUndefined();
  });

  it("returns info with only IPs when DNS is empty", () => {
    vi.mocked(execSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          Self: { DNSName: "", TailscaleIPs: ["100.1.2.3"] },
        }),
      ),
    );

    const info = getTailscaleInfo();
    expect(info?.dnsName).toBeUndefined();
    expect(info?.tailscaleIPs).toEqual(["100.1.2.3"]);
  });
});

// ---------------------------------------------------------------------------
// buildCandidateUrls
// ---------------------------------------------------------------------------

describe("buildCandidateUrls", () => {
  it("returns localhost candidates when info is undefined", () => {
    const candidates = buildCandidateUrls(undefined);
    expect(candidates.map((c) => c.url)).toEqual([
      "http://localhost:3000",
      "http://localhost:3333",
      "http://localhost:5173",
    ]);
  });

  it("orders HTTPS DNS first, then HTTP DNS+ports, then IPs, then localhost", () => {
    const candidates = buildCandidateUrls({
      dnsName: "myhost.ts.net",
      tailscaleIPs: ["100.1.2.3"],
    });
    const urls = candidates.map((c) => c.url);

    // HTTPS first
    expect(urls[0]).toBe("https://myhost.ts.net");
    // HTTP DNS + ports next
    expect(urls[1]).toBe("http://myhost.ts.net:3000");
    expect(urls[2]).toBe("http://myhost.ts.net:3333");
    expect(urls[3]).toBe("http://myhost.ts.net:5173");
    // Tailscale IP + ports
    expect(urls[4]).toBe("http://100.1.2.3:3000");
    expect(urls[5]).toBe("http://100.1.2.3:3333");
    expect(urls[6]).toBe("http://100.1.2.3:5173");
    // localhost last
    expect(urls[7]).toBe("http://localhost:3000");
    expect(urls[8]).toBe("http://localhost:3333");
    expect(urls[9]).toBe("http://localhost:5173");
  });

  it("excludes IPv6 addresses from IP candidates", () => {
    const candidates = buildCandidateUrls({
      dnsName: undefined,
      tailscaleIPs: ["fd7a:115c:a1e0::1"],
    });

    // Only localhost candidates (IPv6 excluded)
    expect(candidates.every((c) => c.url.includes("localhost"))).toBe(true);
  });

  it("assigns increasing priority numbers", () => {
    const candidates = buildCandidateUrls({
      dnsName: "host.ts.net",
      tailscaleIPs: ["100.1.2.3"],
    });

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].priority).toBeGreaterThan(candidates[i - 1].priority);
    }
  });
});

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
