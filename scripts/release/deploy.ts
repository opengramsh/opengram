/**
 * Demo site and docs site deployment to Vercel.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import type { ReleaseContext } from "./types.js";
import { handleCancel, runLive } from "./utils.js";

/**
 * Run a deploy command with retry/skip/abort on failure.
 */
async function runWithRetry(
  label: string,
  cmd: string,
  opts: { cwd: string; dryRun: boolean },
): Promise<boolean> {
  while (true) {
    try {
      await runLive(cmd, opts);
      return true;
    } catch (err) {
      p.log.error(
        `${label} failed: ${err instanceof Error ? err.message : err}`,
      );

      const action = await p.select({
        message: "What would you like to do?",
        options: [
          { value: "retry" as const, label: "Retry" },
          { value: "skip" as const, label: `Skip ${label}` },
          { value: "abort" as const, label: "Abort the entire release" },
        ],
      });
      handleCancel(action);

      if (action === "abort") {
        p.log.error("Release aborted.");
        process.exit(1);
      }
      if (action === "skip") {
        return false;
      }
      // "retry" loops back
    }
  }
}

/**
 * Build and deploy the demo site to Vercel.
 */
export async function deployDemo(ctx: ReleaseContext): Promise<void> {
  const { repoRoot, dryRun } = ctx;

  // Step 1: Build the demo
  p.log.info("Building demo site...");
  const built = await runWithRetry(
    "Demo build",
    "npm -w apps/web run build:demo",
    { cwd: repoRoot, dryRun },
  );
  if (!built) return;
  p.log.success("Demo site built");

  // Step 2: Deploy to Vercel
  p.log.info("Deploying demo to Vercel...");
  const deployed = await runWithRetry(
    "Demo deploy",
    "vercel --prod --cwd apps/web/dist/demo",
    { cwd: repoRoot, dryRun },
  );
  if (deployed) {
    p.log.success("Demo site deployed");
  }
}

/**
 * Deploy the docs site to Vercel.
 */
export async function deployDocs(ctx: ReleaseContext): Promise<void> {
  const { repoRoot, dryRun } = ctx;

  p.log.info("Deploying docs to Vercel...");
  const deployed = await runWithRetry(
    "Docs deploy",
    "vercel --prod --cwd apps/docs",
    { cwd: repoRoot, dryRun },
  );
  if (deployed) {
    p.log.success("Docs site deployed");
  }
}
