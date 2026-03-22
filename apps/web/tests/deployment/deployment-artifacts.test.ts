import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("deployment artifacts", () => {
  it("provides Docker packaging with persistence and healthcheck", () => {
    expect(existsSync("Dockerfile")).toBe(true);
    const dockerfile = readFileSync("Dockerfile", "utf8");

    expect(dockerfile).toContain("dist/server/");
    expect(dockerfile).toContain("dist/client/");
    expect(dockerfile).toContain("node_modules/");
    expect(dockerfile).toContain("COPY --from=builder /app/apps/web/deploy/docker/");
    expect(dockerfile).toContain("entrypoint.sh");
    expect(dockerfile).toContain('VOLUME ["/opt/opengram/data"]');
    expect(dockerfile).toContain("/api/v1/health");
  });

  it("aligns startup commands on the server.js artifact", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
    const entrypoint = readFileSync("deploy/docker/entrypoint.sh", "utf8");

    expect(pkg.scripts?.start).toBe("node dist/server/server.js");
    expect(entrypoint).toContain("dist/server/server.js");
  });
});
