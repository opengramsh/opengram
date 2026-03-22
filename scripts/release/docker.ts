/**
 * Docker image build.
 *
 * Builds the Docker image with version and "latest" tags.
 * No registry push for now — just a local build.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import type { ReleaseContext } from "./types.js";
import { runLive } from "./utils.js";

/**
 * Build the Docker image from the repo root.
 */
export async function buildDockerImage(ctx: ReleaseContext): Promise<void> {
  const { repoRoot, newVersion, dryRun } = ctx;

  const versionTag = `opengram:${newVersion}`;
  const latestTag = `opengram:latest`;

  const cmd =
    `docker build -f apps/web/Dockerfile` +
    ` -t ${versionTag}` +
    ` -t ${latestTag}` +
    ` .`;

  p.log.info(`Building Docker image...`);
  p.log.info(pc.dim(cmd));

  await runLive(cmd, { cwd: repoRoot, dryRun });

  p.log.success(`Docker image built: ${pc.bold(versionTag)} and ${pc.bold(latestTag)}`);
  p.log.info(
    pc.dim(
      "No registry push configured yet. Push manually if needed:\n" +
        `  docker tag ${versionTag} <registry>/${versionTag}\n` +
        `  docker push <registry>/${versionTag}`,
    ),
  );
}
