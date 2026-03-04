import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { runFullSetup } from "./run-setup.js";

/**
 * Register the `openclaw opengram setup` CLI subcommand.
 *
 * This is a thin adapter: it translates OpenClaw CLI context into
 * a call to the shared `runFullSetup()` orchestrator (which is also
 * used by the standalone `opengram-openclaw` bin).
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
          await runFullSetup({
            baseUrl: opts.baseUrl,
            instanceSecret:
              typeof opts.instanceSecret === "string"
                ? opts.instanceSecret
                : undefined,
            noInstanceSecret: opts.instanceSecret === false,
          });
        });
    },
    { commands: ["opengram"] },
  );
}
