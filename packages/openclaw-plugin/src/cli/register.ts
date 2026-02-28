import path from "node:path";

import type { OpenClawPluginApi, WizardPrompter } from "openclaw/plugin-sdk";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "openclaw/plugin-sdk";

import type { SetupWizardOptions } from "./setup.js";
import { runSetupWizard } from "./setup.js";

/**
 * Register the `openclaw opengram setup` CLI subcommand.
 *
 * This provides a standalone entry point for the setup wizard,
 * independent of `openclaw channels add`.
 */
export function registerOpengramCli(api: OpenClawPluginApi): void {
  api.registerCli(
    (ctx) => {
      const opengram = ctx.program
        .command("opengram")
        .description("OpenGram channel plugin commands");

      opengram
        .command("setup")
        .description("Interactive setup wizard for the OpenGram channel")
        .option("--base-url <url>", "Pre-fill the OpenGram instance URL (skips prompt)")
        .option("--instance-secret <secret>", "Pre-fill the instance secret (skips prompt)")
        .option("--no-instance-secret", "Specify that no instance secret is used (skips prompt)")
        .action(async (opts: { baseUrl?: string; instanceSecret?: string | false }) => {
          // Dynamic import: @clack/prompts is an OpenClaw dependency,
          // available at runtime but not a direct dependency of this plugin.
          const clack = await import("@clack/prompts");
          const prompter = createClackPrompter(clack);

          const wizardOpts: SetupWizardOptions = {};
          if (opts.baseUrl) wizardOpts.baseUrl = opts.baseUrl;
          if (typeof opts.instanceSecret === "string") {
            wizardOpts.instanceSecret = opts.instanceSecret;
          } else if (opts.instanceSecret === false) {
            wizardOpts.noInstanceSecret = true;
          }

          const { cfg: nextCfg, shouldRestart } = await runSetupWizard(
            prompter,
            ctx.config,
            wizardOpts,
          );

          // Write config for the standalone CLI path
          await api.runtime.config.writeConfigFile(nextCfg);
          ctx.logger.info("OpenGram configuration saved to openclaw.json");

          // Auto-approve user:primary in the pairing store so all OpenGram
          // messages pass through with zero friction.
          try {
            const stateDir = api.runtime.state.resolveStateDir();
            const allowFromPath = path.join(stateDir, "credentials", "opengram-allowFrom.json");
            const { value: existing } = await readJsonFileWithFallback<string[]>(allowFromPath, []);
            if (!existing.includes("user:primary")) {
              await writeJsonFileAtomically(allowFromPath, [...existing, "user:primary"]);
            }
            ctx.logger.info("Auto-approved user:primary for OpenGram pairing");
          } catch (err) {
            ctx.logger.warn?.(`Failed to auto-approve user:primary: ${err}`);
          }

          if (shouldRestart) {
            ctx.logger.info("Restarting gateway…");
            // SIGUSR1 is the gateway's graceful restart signal.
            // Small delay to ensure config write is flushed.
            setTimeout(() => process.kill(process.pid, "SIGUSR1"), 500);
          }
        });
    },
    { commands: ["opengram"] },
  );
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
function createClackPrompter(clack: any): WizardPrompter {
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
