import { execSync } from "node:child_process";

/** Raw info extracted from `tailscale status --json`. */
type TailscaleInfo = {
  dnsName: string | undefined;
  tailscaleIPs: string[];
};

/**
 * Extract Tailscale network info (MagicDNS hostname + IPs).
 * Returns `undefined` if Tailscale is unavailable.
 */
function getTailscaleInfo(): TailscaleInfo | undefined {
  try {
    const raw = execSync("tailscale status --json", {
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8");

    const status = JSON.parse(raw) as {
      Self?: { DNSName?: string; TailscaleIPs?: string[] };
    };

    const dnsName = status.Self?.DNSName?.replace(/\.$/, "") || undefined;
    const tailscaleIPs = status.Self?.TailscaleIPs ?? [];

    if (!dnsName && tailscaleIPs.length === 0) return undefined;

    return { dnsName, tailscaleIPs };
  } catch {
    return undefined;
  }
}

/** Candidate ports to probe for a running OpenGram instance. */
const PROBE_PORTS = [3000, 3333, 5173];

/** Timeout for each health probe (ms). */
const PROBE_TIMEOUT_MS = 2000;

type CandidateUrl = {
  url: string;
  priority: number; // lower = better
};

/**
 * Build candidate URLs from Tailscale info + localhost,
 * ordered by preference (lowest priority number = most preferred).
 */
function buildCandidateUrls(
  info: TailscaleInfo | undefined,
): CandidateUrl[] {
  const candidates: CandidateUrl[] = [];
  let priority = 0;

  if (info?.dnsName) {
    // HTTPS with MagicDNS (port 443 implied) — most stable
    candidates.push({ url: `https://${info.dnsName}`, priority: priority++ });

    // HTTP with MagicDNS + explicit ports
    for (const port of PROBE_PORTS) {
      candidates.push({
        url: `http://${info.dnsName}:${port}`,
        priority: priority++,
      });
    }
  }

  // Tailscale IPv4 IPs + explicit ports
  const ipv4 =
    info?.tailscaleIPs?.filter((ip) => !ip.includes(":")) ?? [];
  for (const ip of ipv4) {
    for (const port of PROBE_PORTS) {
      candidates.push({ url: `http://${ip}:${port}`, priority: priority++ });
    }
  }

  // Localhost — lowest priority
  for (const port of PROBE_PORTS) {
    candidates.push({
      url: `http://localhost:${port}`,
      priority: priority++,
    });
  }

  return candidates;
}

/**
 * Probe a single URL's health endpoint.
 * Returns `true` only if the endpoint responds with `{ service: "opengram" }`.
 */
async function probeHealth(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/api/v1/health`, {
        method: "GET",
        signal: controller.signal,
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { service?: string };
      return body.service === "opengram";
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/**
 * Detect a running OpenGram instance by probing health endpoints.
 *
 * Probes all candidate URLs in parallel and returns the highest-priority
 * URL whose health endpoint responds with `{ service: "opengram" }`.
 * Falls back to the Tailscale DNS URL or `http://localhost:3000` if
 * nothing responds.
 */
export async function detectOpengramUrl(): Promise<string> {
  const info = getTailscaleInfo();
  const candidates = buildCandidateUrls(info);

  if (candidates.length === 0) {
    return "http://localhost:3000";
  }

  const results = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      reachable: await probeHealth(c.url),
    })),
  );

  const reachable = results
    .filter((r) => r.reachable)
    .sort((a, b) => a.priority - b.priority);

  if (reachable.length > 0) {
    return reachable[0].url;
  }

  // Nothing responded — suggest Tailscale DNS or localhost
  if (info?.dnsName) {
    return `https://${info.dnsName}`;
  }
  return "http://localhost:3000";
}

