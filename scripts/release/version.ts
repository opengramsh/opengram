/**
 * Version reading, bumping, and cross-package synchronisation.
 *
 * Reads versions from:
 *  - apps/web/package.json            → @opengramsh/opengram
 *  - packages/opengramsh/package.json → opengramsh (wrapper)
 *  - packages/openclaw-plugin/package.json → @opengramsh/openclaw-plugin
 *  - apps/macos/project.yml           → macOS app (MARKETING_VERSION)
 *
 * The wrapper package "opengramsh" always tracks the main app version.
 * Its dependency on @opengramsh/opengram is also kept in sync.
 * The openclaw-plugin and macOS app have independent version cycles.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import type { ReleaseContext, VersionMap } from "./types.js";
import {
  abort,
  bumpSemver,
  handleCancel,
  readJson,
  run,
  writeJson,
} from "./utils.js";

// ─── Read versions ──────────────────────────────────────────────────────────

/** Read the macOS MARKETING_VERSION from project.yml. */
function readMacosVersion(repoRoot: string): string {
  const ymlPath = path.join(repoRoot, "apps/macos/project.yml");
  try {
    const content = readFileSync(ymlPath, "utf8");
    const match = content.match(/MARKETING_VERSION:\s*"([^"]+)"/);
    return match?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Read version from a package.json. */
function readPkgVersion(pkgJsonPath: string): string {
  try {
    const pkg = readJson<{ version: string }>(pkgJsonPath);
    return pkg.version;
  } catch {
    return "unknown";
  }
}

/** Read current versions of all packages and the macOS app. */
export function readVersions(repoRoot: string): VersionMap {
  return {
    opengram: readPkgVersion(
      path.join(repoRoot, "apps/web/package.json"),
    ),
    "openclaw-plugin": readPkgVersion(
      path.join(repoRoot, "packages/openclaw-plugin/package.json"),
    ),
    opengramsh: readPkgVersion(
      path.join(repoRoot, "packages/opengramsh/package.json"),
    ),
    macos: readMacosVersion(repoRoot),
  };
}

// ─── Interactive version selection ──────────────────────────────────────────

/**
 * Ask the user what version to release and which packages to bump.
 * Returns partial ReleaseContext fields.
 */
export async function promptVersions(
  repoRoot: string,
  currentVersions: VersionMap,
  preselectedBumpType?: "patch" | "minor" | "major",
): Promise<{
  newVersion: string;
  newOpenclawVersion: string | null;
  newMacosVersion: string | null;
}> {
  const currentMain = currentVersions.opengram;

  // ── Choose bump type ──────────────────────────────────────────────────────

  let bumpType = preselectedBumpType;

  if (!bumpType) {
    const choice = await p.select({
      message: "What type of release?",
      options: [
        {
          value: "patch" as const,
          label: `patch  (${currentMain} → ${bumpSemver(currentMain, "patch")})`,
        },
        {
          value: "minor" as const,
          label: `minor  (${currentMain} → ${bumpSemver(currentMain, "minor")})`,
        },
        {
          value: "major" as const,
          label: `major  (${currentMain} → ${bumpSemver(currentMain, "major")})`,
        },
        {
          value: "custom" as const,
          label: "custom (enter version manually)",
        },
      ],
    });
    handleCancel(choice);

    if (choice === "custom") {
      const custom = await p.text({
        message: "Enter the new version (e.g. 1.0.0)",
        validate: (val) => {
          if (!/^\d+\.\d+\.\d+$/.test(val)) {
            return "Version must be in semver format (e.g. 1.0.0)";
          }
        },
      });
      handleCancel(custom);
      const newVersion = custom as string;

      return promptIndependentVersions(
        repoRoot,
        currentVersions,
        newVersion,
      );
    }

    bumpType = choice as "patch" | "minor" | "major";
  }

  const newVersion = bumpSemver(currentMain, bumpType);

  return promptIndependentVersions(repoRoot, currentVersions, newVersion);
}

/**
 * After the main version is decided, ask about openclaw-plugin and macOS.
 */
async function promptIndependentVersions(
  repoRoot: string,
  currentVersions: VersionMap,
  newVersion: string,
): Promise<{
  newVersion: string;
  newOpenclawVersion: string | null;
  newMacosVersion: string | null;
}> {
  // Show what will be bumped
  p.log.info(
    `\n` +
      `  ${pc.bold("@opengramsh/opengram")}       ${pc.dim(currentVersions.opengram)} → ${pc.green(newVersion)}\n` +
      `  ${pc.bold("opengramsh")}                 ${pc.dim(currentVersions.opengramsh)} → ${pc.green(newVersion)} ${pc.dim("(auto-synced)")}\n` +
      `  ${pc.bold("@opengramsh/openclaw-plugin")} ${pc.dim(currentVersions["openclaw-plugin"])}\n` +
      `  ${pc.bold("macOS app")}                  ${pc.dim(currentVersions.macos)}`,
  );

  // ── openclaw-plugin ───────────────────────────────────────────────────────

  let newOpenclawVersion: string | null = null;

  const bumpOpenclaw = await p.select({
    message: `Bump @opengramsh/openclaw-plugin? (currently ${currentVersions["openclaw-plugin"]})`,
    options: [
      {
        value: "no" as const,
        label: `No, keep at ${currentVersions["openclaw-plugin"]}`,
      },
      {
        value: "sync" as const,
        label: `Yes, bump to ${newVersion} (sync with main)`,
      },
      {
        value: "custom" as const,
        label: "Yes, bump to a different version",
      },
    ],
  });
  handleCancel(bumpOpenclaw);

  if (bumpOpenclaw === "sync") {
    newOpenclawVersion = newVersion;
  } else if (bumpOpenclaw === "custom") {
    const custom = await p.text({
      message: "Enter the new openclaw-plugin version",
      validate: (val) => {
        if (!/^\d+\.\d+\.\d+$/.test(val)) {
          return "Version must be in semver format (e.g. 1.0.0)";
        }
      },
    });
    handleCancel(custom);
    newOpenclawVersion = custom as string;
  }

  // ── macOS ─────────────────────────────────────────────────────────────────

  let newMacosVersion: string | null = null;

  if (process.platform === "darwin") {
    const bumpMacos = await p.select({
      message: `Bump macOS app version? (currently ${currentVersions.macos})`,
      options: [
        {
          value: "no" as const,
          label: `No, keep at ${currentVersions.macos}`,
        },
        {
          value: "sync" as const,
          label: `Yes, bump to ${newVersion} (sync with main)`,
        },
        {
          value: "custom" as const,
          label: "Yes, bump to a different version",
        },
      ],
    });
    handleCancel(bumpMacos);

    if (bumpMacos === "sync") {
      newMacosVersion = newVersion;
    } else if (bumpMacos === "custom") {
      const custom = await p.text({
        message: "Enter the new macOS version",
        validate: (val) => {
          if (!/^\d+\.\d+\.\d+$/.test(val)) {
            return "Version must be in semver format (e.g. 1.0.0)";
          }
        },
      });
      handleCancel(custom);
      newMacosVersion = custom as string;
    }
  }

  return { newVersion, newOpenclawVersion, newMacosVersion };
}

// ─── Apply version bumps ────────────────────────────────────────────────────

/**
 * Write the new versions to all relevant files.
 * Returns a list of files that were modified (for git staging).
 */
export function applyVersionBumps(ctx: ReleaseContext): string[] {
  const modifiedFiles: string[] = [];

  // 1. Bump @opengramsh/opengram
  const opengramPkgPath = path.join(ctx.repoRoot, "apps/web/package.json");
  const opengramPkg = readJson<Record<string, unknown>>(opengramPkgPath);
  opengramPkg.version = ctx.newVersion;
  writeJson(opengramPkgPath, opengramPkg);
  modifiedFiles.push("apps/web/package.json");
  p.log.success(
    `@opengramsh/opengram ${pc.dim(ctx.currentVersions.opengram)} → ${pc.green(ctx.newVersion)}`,
  );

  // 2. Sync opengramsh wrapper — both version and dependency
  const wrapperPkgPath = path.join(
    ctx.repoRoot,
    "packages/opengramsh/package.json",
  );
  const wrapperPkg = readJson<Record<string, unknown>>(wrapperPkgPath);
  wrapperPkg.version = ctx.newVersion;
  const deps = wrapperPkg.dependencies as Record<string, string>;
  deps["@opengramsh/opengram"] = ctx.newVersion;
  writeJson(wrapperPkgPath, wrapperPkg);
  modifiedFiles.push("packages/opengramsh/package.json");
  p.log.success(
    `opengramsh ${pc.dim(ctx.currentVersions.opengramsh)} → ${pc.green(ctx.newVersion)} ${pc.dim("(+ dependency synced)")}`,
  );

  // 3. Optionally bump openclaw-plugin
  if (ctx.newOpenclawVersion) {
    const openclawPkgPath = path.join(
      ctx.repoRoot,
      "packages/openclaw-plugin/package.json",
    );
    const openclawPkg = readJson<Record<string, unknown>>(openclawPkgPath);
    openclawPkg.version = ctx.newOpenclawVersion;
    writeJson(openclawPkgPath, openclawPkg);
    modifiedFiles.push("packages/openclaw-plugin/package.json");
    p.log.success(
      `@opengramsh/openclaw-plugin ${pc.dim(ctx.currentVersions["openclaw-plugin"])} → ${pc.green(ctx.newOpenclawVersion)}`,
    );
  }

  // 4. Optionally bump macOS version (delegates to existing script)
  if (ctx.newMacosVersion) {
    const scriptPath = path.join(
      ctx.repoRoot,
      "apps/macos/scripts/bump-version.sh",
    );
    run(`bash "${scriptPath}" ${ctx.newMacosVersion}`, {
      cwd: path.join(ctx.repoRoot, "apps/macos"),
      dryRun: ctx.dryRun,
    });
    modifiedFiles.push("apps/macos/project.yml");
    p.log.success(
      `macOS app ${pc.dim(ctx.currentVersions.macos)} → ${pc.green(ctx.newMacosVersion)}`,
    );
  }

  // 5. Update package-lock.json
  if (!ctx.dryRun) {
    p.log.info("Updating package-lock.json...");
    run("npm install --package-lock-only", { cwd: ctx.repoRoot });
    modifiedFiles.push("package-lock.json");
    p.log.success("package-lock.json updated");
  }

  return modifiedFiles;
}
