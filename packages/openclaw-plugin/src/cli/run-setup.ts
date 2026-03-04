import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import path from "node:path";

import type { OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk";

import type { SetupWizardOptions } from "./setup.js";
import { runSetupWizard } from "./setup.js";

// ---------------------------------------------------------------------------
// OpenClaw path helpers
// ---------------------------------------------------------------------------

const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? path.join(homedir(), ".openclaw");

/**
 * Locate `openclaw.json` on disk.
 *
 * Resolution order:
 *   1. `OPENCLAW_CONFIG` env var (explicit override)
 *   2. Walk up from `cwd` looking for `openclaw.json`
 *   3. Default `~/.openclaw/openclaw.json`
 */
export function findOpenClawConfig(): string {
  if (process.env.OPENCLAW_CONFIG) return process.env.OPENCLAW_CONFIG;

  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, "openclaw.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return path.join(OPENCLAW_HOME, "openclaw.json");
}

export function readOpenClawConfig(configPath: string): OpenClawConfig {
  if (!existsSync(configPath)) return {} as OpenClawConfig;
  return JSON.parse(readFileSync(configPath, "utf8")) as OpenClawConfig;
}

export function writeOpenClawConfig(configPath: string, cfg: OpenClawConfig): void {
  mkdirSync(path.dirname(configPath), { recursive: true });

  // Atomic write: tmp file + rename
  const tmp = path.join(
    path.dirname(configPath),
    `.openclaw.json.${randomBytes(4).toString("hex")}.tmp`,
  );
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  renameSync(tmp, configPath);
}

/**
 * Ensure `user:primary` is in the pairing allowlist so messages
 * flow with zero friction.
 */
export function autoApprovePairing(stateDir?: string): void {
  const dir = stateDir ?? path.join(OPENCLAW_HOME, "state");
  const allowFromPath = path.join(dir, "credentials", "opengram-allowFrom.json");

  let existing: string[] = [];
  try {
    existing = JSON.parse(readFileSync(allowFromPath, "utf8"));
  } catch {
    // File doesn't exist or is invalid — start with empty array
  }

  if (!existing.includes("user:primary")) {
    mkdirSync(path.dirname(allowFromPath), { recursive: true });
    writeFileSync(
      allowFromPath,
      JSON.stringify([...existing, "user:primary"], null, 2) + "\n",
      "utf8",
    );
  }
}

// ---------------------------------------------------------------------------
// Clack adapter
// ---------------------------------------------------------------------------

/**
 * Wrap @clack/prompts into the WizardPrompter interface expected by the wizard.
 *
 * @clack/prompts types diverge slightly from WizardPrompter (e.g. validate
 * accepts `string | undefined`). We bridge with runtime-safe casts since
 * the underlying behaviour is identical.
 */
export function createClackPrompter(clack: any): WizardPrompter {
  function assertNotCancelled<T>(value: T | symbol): asserts value is T {
    if (clack.isCancel(value)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }
  }

  return {
    async intro(title: string) {
      clack.intro(title);
    },
    async outro(message: string) {
      clack.outro(message);
    },
    async note(message: string, title?: string) {
      clack.note(message, title);
    },
    async select<T>(params: {
      message: string;
      options: Array<{ value: T; label: string; hint?: string }>;
      initialValue?: T;
    }): Promise<T> {
      const result = await clack.select(params);
      assertNotCancelled(result);
      return result;
    },
    async multiselect<T>(params: {
      message: string;
      options: Array<{ value: T; label: string; hint?: string }>;
      initialValues?: T[];
    }): Promise<T[]> {
      const result = await clack.multiselect(params);
      assertNotCancelled(result);
      return result;
    },
    async text(params: {
      message: string;
      initialValue?: string;
      placeholder?: string;
      validate?: (value: string) => string | undefined;
    }): Promise<string> {
      const result = await clack.text(params);
      assertNotCancelled(result);
      return result;
    },
    async confirm(params: {
      message: string;
      initialValue?: boolean;
    }): Promise<boolean> {
      const result = await clack.confirm(params);
      assertNotCancelled(result);
      return result;
    },
    progress(label: string) {
      const spinner = clack.spinner();
      spinner.start(label);
      return {
        update(message: string) {
          spinner.message(message);
        },
        stop(message?: string) {
          spinner.stop(message);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Full setup orchestrator
// ---------------------------------------------------------------------------

export type FullSetupOptions = {
  baseUrl?: string;
  instanceSecret?: string;
  noInstanceSecret?: boolean;
  /** Explicit path to openclaw.json. Auto-detected if omitted. */
  configPath?: string;
  /** Explicit state dir (e.g. ~/.openclaw/state). Auto-detected if omitted. */
  stateDir?: string;
};

/**
 * Run the complete OpenGram setup flow:
 *   1. Read openclaw.json
 *   2. Run the interactive wizard
 *   3. Write updated config back to disk
 *   4. Auto-approve user:primary for pairing
 *   5. Optionally restart the gateway (SIGUSR1)
 *
 * Used by both `opengram-openclaw setup` (standalone) and
 * `openclaw opengram setup` (OpenClaw plugin CLI).
 */
export async function runFullSetup(options?: FullSetupOptions): Promise<void> {
  const clack = await import("@clack/prompts");
  const prompter = createClackPrompter(clack);

  const configPath = options?.configPath ?? findOpenClawConfig();
  const cfg = readOpenClawConfig(configPath);

  const wizardOpts: SetupWizardOptions = {};
  if (options?.baseUrl) wizardOpts.baseUrl = options.baseUrl;
  if (options?.instanceSecret) wizardOpts.instanceSecret = options.instanceSecret;
  if (options?.noInstanceSecret) wizardOpts.noInstanceSecret = true;

  const { cfg: nextCfg, shouldRestart } = await runSetupWizard(
    prompter,
    cfg,
    wizardOpts,
  );

  writeOpenClawConfig(configPath, nextCfg);
  console.log(`OpenGram configuration saved to ${configPath}`);

  try {
    autoApprovePairing(options?.stateDir);
    console.log("Auto-approved user:primary for OpenGram pairing");
  } catch (err) {
    console.warn(`Failed to auto-approve user:primary: ${err}`);
  }

  if (shouldRestart) {
    const { execSync } = await import("node:child_process");
    try {
      execSync("openclaw gateway restart", { stdio: "inherit" });
    } catch {
      console.warn("Could not restart gateway. Run manually: openclaw gateway restart");
    }
  }
}
