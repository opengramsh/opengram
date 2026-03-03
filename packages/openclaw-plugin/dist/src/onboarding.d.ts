import type { ChannelOnboardingAdapter } from "openclaw/plugin-sdk";
/**
 * Onboarding adapter for `openclaw channels add --channel opengram`.
 *
 * The framework calls `configure()` with a WizardPrompter and expects
 * back the modified config. The framework handles persistence.
 */
export declare const opengramOnboardingAdapter: ChannelOnboardingAdapter;
