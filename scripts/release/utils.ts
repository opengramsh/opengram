/**
 * Shared utility functions for the release script.
 */

import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import * as p from "@clack/prompts";
import pc from "picocolors";

// ─── Shell execution ─────────────────────────────────────────────────────────

/**
 * Run a shell command and return its stdout (trimmed).
 *
 * In dry-run mode, logs the command without executing it and returns "".
 */
export function run(
  cmd: string,
  opts?: { cwd?: string; dryRun?: boolean },
): string {
  if (opts?.dryRun) {
    p.log.info(`${pc.dim("[dry-run]")} ${pc.cyan(cmd)}`);
    return "";
  }

  return execSync(cmd, {
    cwd: opts?.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
}

/**
 * Run a shell command with inherited stdio so the user sees its output
 * in real time. Returns a promise that resolves when the command exits.
 *
 * Used for long-running commands like tests and macOS builds.
 */
export function runLive(
  cmd: string,
  opts?: { cwd?: string; dryRun?: boolean },
): Promise<void> {
  if (opts?.dryRun) {
    p.log.info(`${pc.dim("[dry-run]")} ${pc.cyan(cmd)}`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      cwd: opts?.cwd,
      shell: true,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${cmd}`));
      }
    });

    child.on("error", reject);
  });
}

// ─── JSON file helpers ───────────────────────────────────────────────────────

/**
 * Read and parse a JSON file. Returns the parsed object.
 */
export function readJson<T = Record<string, unknown>>(filePath: string): T {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

/**
 * Write an object to a JSON file with 2-space indentation and a trailing newline.
 */
export function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ─── Prompt helpers ──────────────────────────────────────────────────────────

/**
 * Check if the user cancelled a prompt and exit cleanly if so.
 * Call this after every @clack/prompts call.
 */
export function handleCancel(value: unknown): void {
  if (p.isCancel(value)) {
    p.outro(pc.yellow("Release cancelled."));
    process.exit(0);
  }
}

/**
 * Show an error message and exit with code 1.
 */
export function abort(message: string): never {
  p.outro(pc.red(message));
  process.exit(1);
}

// ─── Version helpers ─────────────────────────────────────────────────────────

/**
 * Compute a new version by incrementing the given semver component.
 * E.g. bumpSemver("0.1.3", "minor") => "0.2.0"
 */
export function bumpSemver(
  current: string,
  type: "patch" | "minor" | "major",
): string {
  const parts = current.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    abort(`Invalid semver version: ${current}`);
  }
  const [major, minor, patch] = parts;

  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

// ─── Tool availability ──────────────────────────────────────────────────────

/**
 * Check if a CLI tool is available on PATH.
 * Returns true if the tool is found, false otherwise.
 */
export function isToolAvailable(tool: string): boolean {
  try {
    execSync(`which ${tool}`, { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}
