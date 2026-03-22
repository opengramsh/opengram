/**
 * Shared types for the release script.
 */

/** Identifiers for the three npm packages in this monorepo. */
export type PackageId = "opengram" | "openclaw-plugin" | "opengramsh";

/** Human-readable names for display in prompts. */
export const PACKAGE_NAMES: Record<PackageId, string> = {
  opengram: "@opengramsh/opengram",
  "openclaw-plugin": "@opengramsh/openclaw-plugin",
  opengramsh: "opengramsh",
};

/** Workspace paths relative to the repo root. */
export const PACKAGE_DIRS: Record<PackageId, string> = {
  opengram: "apps/web",
  "openclaw-plugin": "packages/openclaw-plugin",
  opengramsh: "packages/opengramsh",
};

/** Which release targets the user has selected. */
export type ReleaseTargets = {
  /** Which npm packages to publish. */
  npmPackages: PackageId[];
  /** Whether to create a GitHub Release. */
  githubRelease: boolean;
  /** Whether to build a Docker image. */
  docker: boolean;
  /** Whether to build the macOS app (only available on macOS). */
  macos: boolean;
  /** Whether to deploy the demo site to Vercel. */
  deployDemo: boolean;
  /** Whether to deploy the docs site to Vercel. */
  deployDocs: boolean;
};

/** Current version numbers across the monorepo. */
export type VersionMap = {
  opengram: string;
  "openclaw-plugin": string;
  opengramsh: string;
  macos: string;
};

/** The full context that flows through the release pipeline. */
export type ReleaseContext = {
  /** Absolute path to the repo root. */
  repoRoot: string;

  /** Current git branch name. */
  currentBranch: string;

  /** Current version numbers (before bump). */
  currentVersions: VersionMap;

  /** The new version for the main app (@opengramsh/opengram). */
  newVersion: string;

  /** The new version for openclaw-plugin (may differ from newVersion). */
  newOpenclawVersion: string | null;

  /** The new version for the macOS app (may differ from newVersion). */
  newMacosVersion: string | null;

  /** Git tag name, e.g. "v0.2.0". */
  tagName: string;

  /** Generated changelog markdown text. */
  changelog: string;

  /** What to release. */
  targets: ReleaseTargets;

  /** If true, print commands without executing them. */
  dryRun: boolean;
};
