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
import { run } from "./utils.js";

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
export function createGithubRelease(ctx: ReleaseContext): void {
  const { repoRoot, tagName, changelog, dryRun } = ctx;
  const opts = { cwd: repoRoot, dryRun };

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
      `${pc.dim("[dry-run]")} ${pc.cyan(`gh release create ${tagName} --title "${tagName}" --notes "..."`)}`
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
