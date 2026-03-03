import type { OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk";
export type SetupWizardOptions = {
    baseUrl?: string;
    instanceSecret?: string;
    noInstanceSecret?: boolean;
};
export type SetupWizardResult = {
    cfg: OpenClawConfig;
    shouldRestart: boolean;
};
/**
 * Run the OpenGram setup wizard.
 *
 * The wizard is framework-agnostic: it accepts a WizardPrompter and returns a
 * modified config object. The caller is responsible for persistence.
 */
export declare function runSetupWizard(prompter: WizardPrompter, cfg: OpenClawConfig, options?: SetupWizardOptions): Promise<SetupWizardResult>;
export type OpenGramSetupInput = {
    baseUrl: string;
    instanceSecret?: string;
    agents: string[];
    pluginDir?: string;
};
/**
 * Apply wizard answers onto a config object, returning a new config.
 * Does not write to disk — the caller decides persistence.
 */
export declare function applyOpenGramConfig(cfg: OpenClawConfig, input: OpenGramSetupInput): OpenClawConfig;
