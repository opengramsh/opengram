import { describe, expect, it, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { detectTailscaleUrl } from "../src/cli/tailscale.js";

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
