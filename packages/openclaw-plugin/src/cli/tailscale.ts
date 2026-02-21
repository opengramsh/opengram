import { execSync } from "node:child_process";

/**
 * Attempt to detect the local Tailscale MagicDNS hostname.
 * Returns a suggested base URL like `https://myhost.tail1234.ts.net`
 * or `undefined` if Tailscale is unavailable or MagicDNS is disabled.
 */
export function detectTailscaleUrl(): string | undefined {
  try {
    const raw = execSync("tailscale status --json", {
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8");

    const status = JSON.parse(raw) as {
      Self?: { DNSName?: string };
    };

    const dnsName = status.Self?.DNSName;
    if (!dnsName) return undefined;

    // DNSName has a trailing dot — strip it
    const hostname = dnsName.replace(/\.$/, "");
    if (!hostname) return undefined;

    return `https://${hostname}`;
  } catch {
    return undefined;
  }
}
