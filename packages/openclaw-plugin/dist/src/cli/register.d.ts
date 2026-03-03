import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
/**
 * Register the `openclaw opengram setup` CLI subcommand.
 *
 * This provides a standalone entry point for the setup wizard,
 * independent of `openclaw channels add`.
 */
export declare function registerOpengramCli(api: OpenClawPluginApi): void;
