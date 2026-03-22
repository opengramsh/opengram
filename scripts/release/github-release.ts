/**
 * Create a GitHub Release using the `gh` CLI.
 *
 * This also triggers the existing publish.yml workflow,
 * which will publish @opengramsh/opengram to npm (idempotent).
 */

import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import type { ReleaseContext } from "./types.js";
import { handleCancel, run, runLive } from "./utils.js";

/**
 * Check if the user is authenticated with the GitHub CLI.
 */
function isGhAuthenticated(repoRoot: string): boolean {
  try {
    run("gh auth status", { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the user is authenticated with gh, offering to log in interactively.
 * Returns true if authenticated, false if the user chose to skip.
 */
async function ensureGhAuth(repoRoot: string): Promise<boolean> {
  if (isGhAuthenticated(repoRoot)) {
    return true;
  }

  p.log.warn("Not authenticated with GitHub CLI.");

  const action = await p.select({
    message:
      "GitHub CLI authentication is required. What would you like to do?",
    options: [
      {
        value: "login" as const,
        label: "Log in now",
        hint: "runs gh auth login",
      },
      { value: "skip" as const, label: "Skip GitHub Release" },
    ],
  });
  handleCancel(action);

  if (action === "skip") {
    return false;
  }

  // Run gh auth login interactively
  p.log.info("Starting GitHub CLI login...");
  try {
    await runLive("gh auth login", { cwd: repoRoot });
  } catch {
    p.log.error("gh auth login did not complete successfully.");
  }

  // Verify login worked
  if (isGhAuthenticated(repoRoot)) {
    p.log.success("Authenticated with GitHub CLI");
    return true;
  }

  p.log.error("Still not authenticated after login attempt.");
  return false;
}

/**
 * Check if a GitHub Release already exists for this tag.
 */
function releaseExists(
  tagName: string,
  repoRoot: string,
): boolean {
  try {
    run(`gh release view ${tagName}`, { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a GitHub Release and optionally upload a macOS DMG.
 */
export async function createGithubRelease(
  ctx: ReleaseContext,
): Promise<void> {
  const { repoRoot, tagName, changelog, dryRun } = ctx;
  const opts = { cwd: repoRoot, dryRun };

  // Check gh auth (with interactive login option)
  if (!dryRun) {
    const authenticated = await ensureGhAuth(repoRoot);
    if (!authenticated) return;
  }

  // Check if release already exists
  if (!dryRun && releaseExists(tagName, repoRoot)) {
    p.log.warn(
      `GitHub Release ${pc.bold(tagName)} already exists — skipping`,
    );
    return;
  }

  // Use changelog as release notes, or a default message
  const notes = changelog || `Release ${tagName}`;

  // Create the release.
  // We write the notes to a temp file to avoid shell escaping issues.
  if (dryRun) {
    p.log.info(
      `${pc.dim("[dry-run]")} ${pc.cyan(`gh release create ${tagName} --title "${tagName}" --notes "..."`)}`,
    );
  } else {
    const notesFile = path.join(repoRoot, ".release-notes.md");
    writeFileSync(notesFile, notes, "utf8");

    try {
      run(
        `gh release create ${tagName} --title "${tagName}" --notes-file "${notesFile}"`,
        opts,
      );
      p.log.success(`GitHub Release ${pc.bold(tagName)} created`);
    } finally {
      try {
        unlinkSync(notesFile);
      } catch {
        // ignore
      }
    }
  }

  // Upload macOS DMG if it exists
  const dmgPath = path.join(repoRoot, "apps/macos/build/Opengram.dmg");
  if (existsSync(dmgPath)) {
    p.log.info("Uploading macOS DMG to release...");
    run(`gh release upload ${tagName} "${dmgPath}"`, opts);
    p.log.success("DMG uploaded to release");
  }

  p.log.info(
    pc.dim(
      "Note: This triggers CI publish of @opengramsh/opengram (idempotent with local publish)",
    ),
  );
}
