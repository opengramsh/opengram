/**
 * Opengram Release Script
 *
 * Interactive CLI that guides you through every step of a release:
 *   1. Pre-flight checks (clean tree, branch, tests)
 *   2. Version bumping (with cross-package sync)
 *   3. Changelog generation
 *   4. Git commit, tag, push
 *   5. npm publishing
 *   6. GitHub Release creation
 *   7. Docker image build
 *   8. macOS app build + notarisation + Sparkle appcast
 *   9. Demo & docs site deployment
 *
 * Usage:
 *   npm run release                    # Full interactive mode
 *   npm run release -- --dry-run       # Preview all steps
 *   npm run release -- --patch         # Pre-select patch bump
 *   npm run release -- --minor         # Pre-select minor bump
 *   npm run release -- --major         # Pre-select major bump
 */

import { parseArgs } from "node:util";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";

import type { PackageId, ReleaseContext, ReleaseTargets } from "./release/types.js";
import { PACKAGE_NAMES } from "./release/types.js";
import { handleCancel } from "./release/utils.js";
import { requireTool, runPreflightChecks } from "./release/preflight.js";
import { applyVersionBumps, promptVersions, readVersions } from "./release/version.js";
import { generateChangelog, writeChangelogFile } from "./release/changelog.js";
import { commitTagAndPush } from "./release/git.js";
import { publishToNpm } from "./release/npm-publish.js";
import { createGithubRelease } from "./release/github-release.js";
import { buildDockerImage } from "./release/docker.js";
import { buildMacosApp } from "./release/macos.js";
import { deployDemo, deployDocs } from "./release/deploy.js";

// ─── Parse CLI arguments ────────────────────────────────────────────────────

const { values: flags } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    patch: { type: "boolean", default: false },
    minor: { type: "boolean", default: false },
    major: { type: "boolean", default: false },
  },
  strict: false,
});

const dryRun = flags["dry-run"] ?? false;
const preselectedBump = flags.patch
  ? ("patch" as const)
  : flags.minor
    ? ("minor" as const)
    : flags.major
      ? ("major" as const)
      : undefined;

// ─── Resolve repo root ─────────────────────────────────────────────────────

// This script lives at <repo>/scripts/release.ts
const repoRoot = path.resolve(import.meta.dirname, "..");

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  p.intro(
    pc.bold("Opengram Release") + (dryRun ? pc.yellow(" [DRY RUN]") : ""),
  );

  // ── Step 1: Pre-flight checks ─────────────────────────────────────────────

  const currentBranch = await runPreflightChecks(repoRoot);

  // ── Step 2: Version selection ─────────────────────────────────────────────

  p.log.step(pc.bold("Version"));

  const currentVersions = readVersions(repoRoot);
  const { newVersion, newOpenclawVersion, newMacosVersion } =
    await promptVersions(repoRoot, currentVersions, preselectedBump);

  // ── Step 3: Select release targets ────────────────────────────────────────

  p.log.step(pc.bold("Release targets"));

  // npm packages — always include opengram and opengramsh
  const npmPackages: PackageId[] = ["opengram", "opengramsh"];
  if (newOpenclawVersion) {
    npmPackages.push("openclaw-plugin");
  }

  const publishNpm = await p.confirm({
    message: `Publish to npm? (${npmPackages.map((id) => PACKAGE_NAMES[id]).join(", ")})`,
    initialValue: true,
  });
  handleCancel(publishNpm);

  const githubRelease = await p.confirm({
    message: "Create a GitHub Release?",
    initialValue: true,
  });
  handleCancel(githubRelease);

  // Docker
  let docker = false;
  if (requireTool("docker", "Docker image build")) {
    const answer = await p.confirm({
      message: "Build Docker image?",
      initialValue: false,
    });
    handleCancel(answer);
    docker = answer as boolean;
  }

  // macOS
  let macos = false;
  if (process.platform === "darwin") {
    const answer = await p.confirm({
      message: "Build macOS app? (build + sign + notarize)",
      initialValue: false,
    });
    handleCancel(answer);
    macos = answer as boolean;
  }

  // Demo site
  let deployDemoSite = false;
  if (requireTool("vercel", "Vercel deployment")) {
    const answer = await p.confirm({
      message: "Deploy demo site to Vercel?",
      initialValue: false,
    });
    handleCancel(answer);
    deployDemoSite = answer as boolean;
  }

  // Docs site
  let deployDocsSite = false;
  if (deployDemoSite || requireTool("vercel", "Vercel deployment")) {
    const answer = await p.confirm({
      message: "Deploy docs site to Vercel?",
      initialValue: false,
    });
    handleCancel(answer);
    deployDocsSite = answer as boolean;
  }

  const targets: ReleaseTargets = {
    npmPackages: publishNpm ? npmPackages : [],
    githubRelease: githubRelease as boolean,
    docker,
    macos,
    deployDemo: deployDemoSite,
    deployDocs: deployDocsSite,
  };

  // Check for required tools based on selected targets
  if (targets.githubRelease && !requireTool("gh", "GitHub Release creation")) {
    targets.githubRelease = false;
  }

  // ── Step 4: Changelog ─────────────────────────────────────────────────────

  p.log.step(pc.bold("Changelog"));

  const changelog = await generateChangelog(repoRoot, newVersion);

  // ── Step 5: Summary & confirmation ────────────────────────────────────────

  const summaryLines = [
    `  Version:    ${pc.bold(pc.green(`v${newVersion}`))}`,
    `  Tag:        ${pc.bold(`v${newVersion}`)}`,
  ];

  if (newOpenclawVersion) {
    summaryLines.push(
      `  openclaw:   ${pc.bold(pc.green(`v${newOpenclawVersion}`))}`,
    );
  }
  if (newMacosVersion) {
    summaryLines.push(
      `  macOS:      ${pc.bold(pc.green(`v${newMacosVersion}`))}`,
    );
  }

  summaryLines.push("");

  if (targets.npmPackages.length > 0) {
    summaryLines.push(
      `  npm:        ${targets.npmPackages.map((id) => PACKAGE_NAMES[id]).join(", ")}`,
    );
  } else {
    summaryLines.push(`  npm:        ${pc.dim("skip")}`);
  }

  summaryLines.push(
    `  GitHub:     ${targets.githubRelease ? "Create release" : pc.dim("skip")}`,
  );
  summaryLines.push(
    `  Docker:     ${targets.docker ? "Build image" : pc.dim("skip")}`,
  );
  summaryLines.push(
    `  macOS:      ${targets.macos ? "Build + notarize" : pc.dim("skip")}`,
  );
  summaryLines.push(
    `  Demo:       ${targets.deployDemo ? "Deploy to Vercel" : pc.dim("skip")}`,
  );
  summaryLines.push(
    `  Docs:       ${targets.deployDocs ? "Deploy to Vercel" : pc.dim("skip")}`,
  );

  p.note(summaryLines.join("\n"), "Release summary");

  const proceed = await p.select({
    message: "Ready to release?",
    options: [
      { value: "yes" as const, label: "Yes, release!" },
      {
        value: "dry" as const,
        label: "Dry run (preview commands)",
      },
      { value: "abort" as const, label: "Abort" },
    ],
  });
  handleCancel(proceed);

  if (proceed === "abort") {
    p.outro(pc.yellow("Release cancelled."));
    return;
  }

  const effectiveDryRun = dryRun || proceed === "dry";

  // ── Build the release context ─────────────────────────────────────────────

  const ctx: ReleaseContext = {
    repoRoot,
    currentBranch,
    currentVersions,
    newVersion,
    newOpenclawVersion,
    newMacosVersion,
    tagName: `v${newVersion}`,
    changelog,
    targets,
    dryRun: effectiveDryRun,
  };

  // ── Execute release steps ─────────────────────────────────────────────────

  // Count total steps for progress display
  let totalSteps = 2; // version bump + git are always done
  if (changelog) totalSteps++;
  if (targets.npmPackages.length > 0) totalSteps++;
  if (targets.githubRelease) totalSteps++;
  if (targets.docker) totalSteps++;
  if (targets.macos) totalSteps++;
  if (targets.deployDemo) totalSteps++;
  if (targets.deployDocs) totalSteps++;

  let currentStep = 0;
  const step = (label: string) => {
    currentStep++;
    p.log.step(pc.bold(`Step ${currentStep}/${totalSteps}: ${label}`));
  };

  // ── Bump versions ─────────────────────────────────────────────────────────

  step("Bumping versions");
  const modifiedFiles = applyVersionBumps(ctx);

  // ── Write changelog ────────────────────────────────────────────────────────

  if (changelog) {
    step("Writing changelog");
    const changelogFile = writeChangelogFile(repoRoot, changelog);
    modifiedFiles.push(changelogFile);
  }

  // ── Git commit, tag, push ──────────────────────────────────────────────────

  step("Git commit & tag & push");
  commitTagAndPush(ctx, modifiedFiles);

  // ── macOS build (before GitHub Release so DMG can be uploaded) ─────────────

  if (targets.macos) {
    step("macOS app build");
    await buildMacosApp(ctx);
  }

  // ── npm publish ────────────────────────────────────────────────────────────

  if (targets.npmPackages.length > 0) {
    step("Publishing to npm");
    await publishToNpm(ctx);
  }

  // ── GitHub Release ─────────────────────────────────────────────────────────

  if (targets.githubRelease) {
    step("Creating GitHub Release");
    await createGithubRelease(ctx);
  }

  // ── Docker ─────────────────────────────────────────────────────────────────

  if (targets.docker) {
    step("Building Docker image");
    await buildDockerImage(ctx);
  }

  // ── Deploy demo site ──────────────────────────────────────────────────────

  if (targets.deployDemo) {
    step("Deploying demo site");
    await deployDemo(ctx);
  }

  // ── Deploy docs site ──────────────────────────────────────────────────────

  if (targets.deployDocs) {
    step("Deploying docs site");
    await deployDocs(ctx);
  }

  // ── Done! ──────────────────────────────────────────────────────────────────

  if (effectiveDryRun) {
    p.outro(
      pc.yellow("Dry run complete — no changes were made."),
    );
  } else {
    p.outro(
      pc.green(`Release v${newVersion} complete!`),
    );
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────

main().catch((err) => {
  p.log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
