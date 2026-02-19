import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("deployment artifacts", () => {
  it("provides install.sh with required deployment flow", () => {
    expect(existsSync("install.sh")).toBe(true);
    const script = readFileSync("install.sh", "utf8");

    expect(script).toContain('INSTALL_ROOT="/opt/opengram"');
    expect(script).toContain('WEB_DIR="${INSTALL_ROOT}/web"');
    expect(script).toContain('DATA_DIR="${INSTALL_ROOT}/data"');
    expect(script).toContain('CONFIG_DIR="${INSTALL_ROOT}/config"');
    expect(script).toContain("npm run build");
    expect(script).toContain("npm run db:migrate");
    expect(script).toContain('if [[ -f "${ENV_FILE}" ]]; then');
    expect(script).toContain('systemctl enable "${SERVICE_NAME}"');
    expect(script).toContain('systemctl is-active --quiet "${SERVICE_NAME}"');
    expect(script).toContain('systemctl restart "${SERVICE_NAME}"');
    expect(script).toContain('systemctl start "${SERVICE_NAME}"');
    expect(script).toContain("opengram-web.service");
  });

  it("provides systemd unit for opengram-web", () => {
    expect(existsSync("deploy/systemd/opengram-web.service")).toBe(true);
    const unit = readFileSync("deploy/systemd/opengram-web.service", "utf8");

    expect(unit).toContain("WorkingDirectory=/opt/opengram/web");
    expect(unit).toContain("ExecStart=/usr/bin/env node /opt/opengram/web/server.js");
    expect(unit).toContain("Environment=DATABASE_URL=/opt/opengram/data/opengram.db");
  });

  it("provides Docker packaging with persistence and healthcheck", () => {
    expect(existsSync("Dockerfile")).toBe(true);
    const dockerfile = readFileSync("Dockerfile", "utf8");

    expect(dockerfile).toContain(".next/standalone/");
    expect(dockerfile).toContain('VOLUME ["/opt/opengram/data"]');
    expect(dockerfile).toContain("/api/v1/health");
  });

  it("documents tailscale TLS and reverse proxy setup", () => {
    expect(existsSync("docs/deployment.md")).toBe(true);
    const doc = readFileSync("docs/deployment.md", "utf8");

    expect(doc).toContain("Tailscale TLS Setup");
    expect(doc).toContain("MagicDNS");
    expect(doc).toContain("tailscale cert");
    expect(doc).toContain("tailscale serve");
    expect(doc).toContain("Optional Reverse Proxy");
    expect(doc).toContain("Caddy");
    expect(doc).toContain("nginx");
  });
});
