/**
 * npm publishing for selected packages.
 *
 * Publishes in the correct order:
 *   1. @opengramsh/opengram  (must be first — opengramsh depends on it)
 *   2. opengramsh
 *   3. @opengramsh/openclaw-plugin
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import type { PackageId, ReleaseContext } from "./types.js";
import { PACKAGE_DIRS, PACKAGE_NAMES } from "./types.js";
import { handleCancel, run } from "./utils.js";

/** The order in which packages must be published. */
const PUBLISH_ORDER: PackageId[] = [
  "opengram",
  "opengramsh",
  "openclaw-plugin",
];

/**
 * Check if the user is logged in to npm.
 * Returns the username or null if not logged in.
 */
function getNpmUser(repoRoot: string): string | null {
  try {
    return run("npm whoami", { cwd: repoRoot });
  } catch {
    return null;
  }
}

/**
 * Check if a specific version of a package is already published.
 */
function isAlreadyPublished(
  pkgName: string,
  version: string,
  repoRoot: string,
): boolean {
  try {
    run(`npm view ${pkgName}@${version} version`, { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the target version for a given package.
 */
function getTargetVersion(
  pkgId: PackageId,
  ctx: ReleaseContext,
): string {
  if (pkgId === "openclaw-plugin" && ctx.newOpenclawVersion) {
    return ctx.newOpenclawVersion;
  }
  // opengram and opengramsh always use the main version
  return ctx.newVersion;
}

/**
 * Publish selected packages to npm.
 */
export async function publishToNpm(ctx: ReleaseContext): Promise<void> {
  const { repoRoot, targets, dryRun } = ctx;

  // Check npm auth
  if (!dryRun) {
    const npmUser = getNpmUser(repoRoot);
    if (!npmUser) {
      p.log.error("Not logged in to npm. Run `npm login` first.");
      const skip = await p.confirm({
        message: "Skip npm publishing?",
        initialValue: false,
      });
      handleCancel(skip);
      if (skip) return;
      p.log.error("Cannot publish without npm authentication.");
      return;
    }
    p.log.info(`Logged in to npm as ${pc.bold(npmUser)}`);
  }

  // Publish each selected package in order
  const toPublish = PUBLISH_ORDER.filter((id) =>
    targets.npmPackages.includes(id),
  );

  for (const pkgId of toPublish) {
    const pkgName = PACKAGE_NAMES[pkgId];
    const version = getTargetVersion(pkgId, ctx);
    const workspace = PACKAGE_DIRS[pkgId];

    // Check if already published
    if (!dryRun && isAlreadyPublished(pkgName, version, repoRoot)) {
      p.log.warn(`${pkgName}@${version} is already published — skipping`);
      continue;
    }

    // Publish
    const cmd = `npm publish -w ${workspace} --access public`;
    p.log.info(`Publishing ${pc.bold(pkgName)}@${pc.green(version)}...`);

    if (dryRun) {
      p.log.info(`${pc.dim("[dry-run]")} ${pc.cyan(cmd)}`);
    } else {
      try {
        run(cmd, { cwd: repoRoot });
        p.log.success(`${pkgName}@${version} published`);
      } catch (err) {
        p.log.error(
          `Failed to publish ${pkgName}: ${err instanceof Error ? err.message : err}`,
        );
        const action = await p.select({
          message: `What would you like to do?`,
          options: [
            { value: "retry" as const, label: "Retry" },
            { value: "skip" as const, label: "Skip this package" },
            { value: "abort" as const, label: "Abort release" },
          ],
        });
        handleCancel(action);

        if (action === "retry") {
          try {
            run(cmd, { cwd: repoRoot });
            p.log.success(`${pkgName}@${version} published`);
          } catch {
            p.log.error(`Retry also failed — skipping ${pkgName}`);
          }
        } else if (action === "abort") {
          p.log.error("Aborting release.");
          return;
        }
        // "skip" falls through
      }
    }
  }
}
