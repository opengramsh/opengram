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

/** Error subclass that carries the last N lines of output from a failed command. */
export class CommandError extends Error {
  /** The last lines of combined stdout+stderr output. */
  tail: string;
  exitCode: number;

  constructor(cmd: string, exitCode: number, tail: string) {
    super(`Command failed with exit code ${exitCode}: ${cmd}`);
    this.tail = tail;
    this.exitCode = exitCode;
  }
}

/**
 * Run a shell command with output piped to the terminal in real time,
 * while also capturing the last `tailLines` lines of combined output.
 *
 * On success, resolves normally.
 * On failure, rejects with a CommandError that includes the output tail
 * so the caller can display the error context clearly.
 */
export function runLiveCapture(
  cmd: string,
  opts?: { cwd?: string; dryRun?: boolean; tailLines?: number },
): Promise<void> {
  if (opts?.dryRun) {
    p.log.info(`${pc.dim("[dry-run]")} ${pc.cyan(cmd)}`);
    return Promise.resolve();
  }

  const maxLines = opts?.tailLines ?? 20;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      cwd: opts?.cwd,
      shell: true,
      stdio: ["inherit", "pipe", "pipe"],
    });

    // Ring buffer for the last N lines of output
    const recentLines: string[] = [];

    const collectLine = (line: string) => {
      recentLines.push(line);
      if (recentLines.length > maxLines) {
        recentLines.shift();
      }
    };

    // Pipe stdout to terminal and capture
    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line) collectLine(line);
      }
    });

    // Pipe stderr to terminal and capture
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line) collectLine(line);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new CommandError(cmd, code ?? 1, recentLines.join("\n")),
        );
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
