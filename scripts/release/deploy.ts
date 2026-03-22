/**
 * Demo site and docs site deployment to Vercel.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import type { ReleaseContext } from "./types.js";
import { runLive } from "./utils.js";

/**
 * Build and deploy the demo site to Vercel.
 */
export async function deployDemo(ctx: ReleaseContext): Promise<void> {
  const { repoRoot, dryRun } = ctx;

  // Step 1: Build the demo
  p.log.info("Building demo site...");
  await runLive("npm -w apps/web run build:demo", { cwd: repoRoot, dryRun });
  p.log.success("Demo site built");

  // Step 2: Deploy to Vercel
  p.log.info("Deploying demo to Vercel...");
  await runLive("vercel --prod --cwd apps/web/dist/demo", {
    cwd: repoRoot,
    dryRun,
  });
  p.log.success("Demo site deployed");
}

/**
 * Deploy the docs site to Vercel.
 */
export async function deployDocs(ctx: ReleaseContext): Promise<void> {
  const { repoRoot, dryRun } = ctx;

  p.log.info("Deploying docs to Vercel...");
  await runLive("vercel --prod --cwd apps/docs", { cwd: repoRoot, dryRun });
  p.log.success("Docs site deployed");
}
