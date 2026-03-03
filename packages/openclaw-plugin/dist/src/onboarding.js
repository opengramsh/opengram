import { runSetupWizard } from "./cli/setup.js";
/**
 * Onboarding adapter for `openclaw channels add --channel opengram`.
 *
 * The framework calls `configure()` with a WizardPrompter and expects
 * back the modified config. The framework handles persistence.
 */
export const opengramOnboardingAdapter = {
    channel: "opengram",
    async getStatus(ctx) {
        const section = ctx.cfg.channels
            ?.opengram;
        const configured = Boolean(section?.baseUrl?.trim());
        const statusLines = [];
        if (configured) {
            statusLines.push(`URL: ${section.baseUrl}`);
            if (section.agents?.length) {
                statusLines.push(`Agents: ${section.agents.join(", ")}`);
            }
            if (section.defaultModelId) {
                statusLines.push(`Model: ${section.defaultModelId}`);
            }
        }
        else {
            statusLines.push("Not configured");
        }
        return {
            channel: "opengram",
            configured,
            statusLines,
            selectionHint: "Self-hosted PWA chat interface",
            quickstartScore: configured ? 0 : 3,
        };
    },
    async configure(ctx) {
        const { cfg: nextCfg } = await runSetupWizard(ctx.prompter, ctx.cfg);
        return { cfg: nextCfg };
    },
    disable(cfg) {
        const channels = (cfg.channels ?? {});
        return {
            ...cfg,
            channels: {
                ...channels,
                opengram: {
                    ...channels.opengram,
                    enabled: false,
                },
            },
        };
    },
};
