/**
 * Changelog generation from git history.
 *
 * Looks at commits since the last git tag, groups them by conventional-commit
 * prefix (feat, fix, refactor, etc.), and formats a markdown changelog entry.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { handleCancel, run } from "./utils.js";

/** A single parsed commit. */
type ParsedCommit = {
  hash: string;
  type: string;
  scope: string | null;
  message: string;
};

/** Section headers for each commit type. */
const TYPE_LABELS: Record<string, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  refactor: "Refactoring",
  perf: "Performance",
  docs: "Documentation",
  test: "Tests",
  chore: "Chores",
  build: "Build",
  ci: "CI",
  style: "Style",
};

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Get the most recent git tag, or null if no tags exist.
 */
function getLastTag(repoRoot: string): string | null {
  try {
    return run("git describe --tags --abbrev=0", { cwd: repoRoot });
  } catch {
    return null;
  }
}

/**
 * Get commit lines since a tag (or all commits if no tag).
 * Each line is "hash subject".
 */
function getCommitsSince(
  repoRoot: string,
  tag: string | null,
): string[] {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const raw = run(`git log ${range} --oneline --no-merges`, {
    cwd: repoRoot,
  });
  if (!raw) return [];
  return raw.split("\n").filter(Boolean);
}

/**
 * Parse a one-line commit into its parts.
 *
 * Handles formats like:
 *   "abc1234 feat(web): add scroll button"
 *   "def5678 fix: prevent crash"
 *   "ghi9012 some untyped commit"
 */
function parseCommit(line: string): ParsedCommit {
  const hash = line.slice(0, 7);
  const subject = line.slice(8);

  // Match "type(scope): message" or "type: message"
  const match = subject.match(
    /^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/,
  );

  if (match) {
    return {
      hash,
      type: match[1],
      scope: match[2] || null,
      message: match[3],
    };
  }

  // No conventional-commit prefix
  return { hash, type: "other", scope: null, message: subject };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Group commits by type and format as a markdown changelog entry.
 */
function formatChangelog(
  version: string,
  commits: ParsedCommit[],
): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const lines: string[] = [`## ${version} (${today})`, ""];

  // Group by type
  const groups = new Map<string, ParsedCommit[]>();
  for (const commit of commits) {
    const key = commit.type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(commit);
  }

  // Output known types first (in order), then "other"
  const orderedTypes = Object.keys(TYPE_LABELS);
  const allTypes = [
    ...orderedTypes.filter((t) => groups.has(t)),
    ...[...groups.keys()].filter(
      (t) => !orderedTypes.includes(t),
    ),
  ];

  for (const type of allTypes) {
    const groupCommits = groups.get(type);
    if (!groupCommits?.length) continue;

    const label = TYPE_LABELS[type] ?? "Other Changes";
    lines.push(`### ${label}`, "");

    for (const c of groupCommits) {
      const scope = c.scope ? `**${c.scope}:** ` : "";
      lines.push(`- ${scope}${c.message} (${c.hash})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a changelog entry and let the user review it.
 * Returns the final changelog text (or "" if skipped).
 */
export async function generateChangelog(
  repoRoot: string,
  newVersion: string,
): Promise<string> {
  const lastTag = getLastTag(repoRoot);
  const commitLines = getCommitsSince(repoRoot, lastTag);

  if (commitLines.length === 0) {
    p.log.warn("No commits found since last tag — skipping changelog");
    return "";
  }

  p.log.info(
    `Found ${pc.bold(String(commitLines.length))} commits since ${lastTag ? pc.bold(lastTag) : "the beginning"}`,
  );

  const commits = commitLines.map(parseCommit);
  const changelog = formatChangelog(newVersion, commits);

  // Show preview
  p.note(changelog, "Generated changelog");

  // Ask what to do
  const action = await p.select({
    message: "What would you like to do with this changelog?",
    options: [
      { value: "accept" as const, label: "Accept as-is" },
      {
        value: "edit" as const,
        label: "Edit in $EDITOR",
        hint: process.env.EDITOR ?? "vi",
      },
      { value: "skip" as const, label: "Skip changelog" },
    ],
  });
  handleCancel(action);

  if (action === "skip") {
    p.log.warn("Skipping changelog");
    return "";
  }

  let finalChangelog = changelog;

  if (action === "edit") {
    // Write to a temp file, open in editor, read back
    const tmpPath = path.join(repoRoot, ".changelog-draft.md");
    writeFileSync(tmpPath, changelog, "utf8");

    const editor = process.env.EDITOR ?? "vi";
    try {
      execSync(`${editor} "${tmpPath}"`, { stdio: "inherit" });
      finalChangelog = readFileSync(tmpPath, "utf8");
    } catch {
      p.log.warn("Editor exited with error — using original changelog");
    }

    // Clean up temp file
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }

  return finalChangelog;
}

/**
 * Write the changelog entry to the root CHANGELOG.md file.
 * Prepends the new entry at the top of the file.
 * Returns the file path (for git staging).
 */
export function writeChangelogFile(
  repoRoot: string,
  changelog: string,
): string {
  const changelogPath = path.join(repoRoot, "CHANGELOG.md");

  let existing = "";
  if (existsSync(changelogPath)) {
    existing = readFileSync(changelogPath, "utf8");
  }

  // If the file starts with a top-level heading, insert after it.
  // Otherwise just prepend.
  let content: string;
  if (existing.startsWith("# ")) {
    const firstNewline = existing.indexOf("\n");
    const heading = existing.slice(0, firstNewline + 1);
    const rest = existing.slice(firstNewline + 1);
    content = heading + "\n" + changelog + "\n" + rest;
  } else if (existing) {
    content = changelog + "\n" + existing;
  } else {
    content = "# Changelog\n\n" + changelog;
  }

  writeFileSync(changelogPath, content, "utf8");
  p.log.success("CHANGELOG.md updated");

  return "CHANGELOG.md";
}
