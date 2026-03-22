/**
 * Pre-flight checks that run before any release operations.
 *
 * Validates git state, runs tests, and checks for required tools.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { handleCancel, isToolAvailable, run, runLive } from "./utils.js";

/**
 * Run all pre-flight checks. Returns the current branch name.
 *
 * Checks:
 * 1. Working tree is clean
 * 2. On the expected branch (warns if not main)
 * 3. Local branch is in sync with remote
 * 4. Tests pass
 */
export async function runPreflightChecks(repoRoot: string): Promise<string> {
  p.log.step(pc.bold("Pre-flight checks"));

  // 1. Check for uncommitted changes
  const status = run("git status --porcelain", { cwd: repoRoot });
  if (status) {
    p.log.warn(`Working tree has uncommitted changes:\n${pc.dim(status)}`);
    const proceed = await p.confirm({
      message: "Continue anyway?",
      initialValue: false,
    });
    handleCancel(proceed);
    if (!proceed) {
      p.outro(pc.yellow("Release cancelled. Commit or stash your changes first."));
      process.exit(0);
    }
  } else {
    p.log.success("Working tree is clean");
  }

  // 2. Check current branch
  const branch = run("git branch --show-current", { cwd: repoRoot });
  if (branch !== "main") {
    p.log.warn(`On branch ${pc.bold(branch)}, not ${pc.bold("main")}`);
    const proceed = await p.confirm({
      message: `Continue releasing from ${branch}?`,
      initialValue: false,
    });
    handleCancel(proceed);
    if (!proceed) {
      p.outro(pc.yellow("Release cancelled. Switch to main first."));
      process.exit(0);
    }
  } else {
    p.log.success(`On branch: ${pc.bold("main")}`);
  }

  // 3. Check if local is in sync with remote
  try {
    run("git fetch origin", { cwd: repoRoot });
    const diff = run(`git diff origin/${branch} --stat`, { cwd: repoRoot });
    if (diff) {
      p.log.warn(
        `Local branch differs from origin/${branch}:\n${pc.dim(diff)}`,
      );
      const proceed = await p.confirm({
        message: "Continue anyway?",
        initialValue: false,
      });
      handleCancel(proceed);
      if (!proceed) {
        p.outro(pc.yellow("Release cancelled. Push or pull first."));
        process.exit(0);
      }
    } else {
      p.log.success(`In sync with origin/${branch}`);
    }
  } catch {
    p.log.warn("Could not fetch from remote — skipping sync check");
  }

  // 4. Run tests
  const skipTests = await p.confirm({
    message: "Run tests before releasing?",
    initialValue: true,
  });
  handleCancel(skipTests);

  if (skipTests) {
    p.log.info("Running tests...");
    try {
      await runLive("npm test", { cwd: repoRoot });
      p.log.success("Tests passed");
    } catch {
      p.log.error("Tests failed");
      const proceed = await p.confirm({
        message: "Tests failed. Continue anyway?",
        initialValue: false,
      });
      handleCancel(proceed);
      if (!proceed) {
        p.outro(pc.yellow("Release cancelled. Fix the tests first."));
        process.exit(0);
      }
    }
  } else {
    p.log.warn("Skipping tests");
  }

  return branch;
}

/**
 * Check that a specific CLI tool is available.
 * Logs a warning and returns false if not found.
 */
export function requireTool(name: string, purpose: string): boolean {
  if (isToolAvailable(name)) {
    return true;
  }
  p.log.warn(
    `${pc.bold(name)} is not installed — needed for ${purpose}. Skipping.`,
  );
  return false;
}
