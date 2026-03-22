/**
 * Docker image build.
 *
 * Builds the Docker image with version and "latest" tags.
 * No registry push for now — just a local build.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import type { ReleaseContext } from "./types.js";
import { handleCancel, runLive } from "./utils.js";

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

  // Retry loop — the user can start Docker daemon and retry
  while (true) {
    try {
      await runLive(cmd, { cwd: repoRoot, dryRun });
      p.log.success(
        `Docker image built: ${pc.bold(versionTag)} and ${pc.bold(latestTag)}`,
      );
      p.log.info(
        pc.dim(
          "No registry push configured yet. Push manually if needed:\n" +
            `  docker tag ${versionTag} <registry>/${versionTag}\n` +
            `  docker push <registry>/${versionTag}`,
        ),
      );
      return;
    } catch (err) {
      p.log.error(
        `Docker build failed: ${err instanceof Error ? err.message : err}`,
      );

      const action = await p.select({
        message: "What would you like to do?",
        options: [
          {
            value: "retry" as const,
            label: "Retry",
            hint: "e.g. after starting Docker daemon",
          },
          { value: "skip" as const, label: "Skip Docker build" },
          { value: "abort" as const, label: "Abort the entire release" },
        ],
      });
      handleCancel(action);

      if (action === "abort") {
        p.log.error("Release aborted.");
        process.exit(1);
      }
      if (action === "skip") {
        return;
      }
      // "retry" loops back
    }
  }
}
