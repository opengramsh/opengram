/**
 * Git operations: stage files, commit, tag, and push.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import type { ReleaseContext } from "./types.js";
import { run } from "./utils.js";

/**
 * Stage the given files, create a release commit and annotated tag,
 * then push both to the remote.
 *
 * @param ctx     The release context
 * @param files   List of file paths (relative to repo root) to stage
 */
export function commitTagAndPush(
  ctx: ReleaseContext,
  files: string[],
): void {
  const { repoRoot, tagName, newVersion, currentBranch, dryRun } = ctx;
  const opts = { cwd: repoRoot, dryRun };

  // 1. Stage the specific files that were modified
  for (const file of files) {
    run(`git add "${file}"`, opts);
  }
  p.log.success(`Staged ${files.length} file(s)`);

  // 2. Create release commit
  const commitMessage = `release: v${newVersion}`;
  run(`git commit -m "${commitMessage}"`, opts);
  p.log.success(`Committed: ${pc.dim(commitMessage)}`);

  // 3. Create annotated tag
  run(`git tag -a "${tagName}" -m "${tagName}"`, opts);
  p.log.success(`Tagged: ${pc.bold(tagName)}`);

  // 4. Push commit and tag
  run(`git push origin ${currentBranch} --follow-tags`, opts);
  p.log.success(`Pushed to origin/${currentBranch}`);
}
