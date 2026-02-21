import type { OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk";

import { OpenGramClient } from "../api-client.js";
import { detectTailscaleUrl } from "./tailscale.js";

export type SetupWizardResult = {
  cfg: OpenClawConfig;
  shouldRestart: boolean;
};

/**
 * Run the 7-step OpenGram setup wizard.
 *
 * The wizard is framework-agnostic: it accepts a WizardPrompter and returns a
 * modified config object. The caller is responsible for persistence.
 */
export async function runSetupWizard(
  prompter: WizardPrompter,
  cfg: OpenClawConfig,
): Promise<SetupWizardResult> {
  await prompter.intro("OpenGram Setup");

  // --- Step 1: OpenGram URL ---
  const baseUrl = await promptBaseUrl(prompter);

  // --- Step 2: Connection test ---
  await testConnection(prompter, baseUrl);

  // --- Step 3: Instance secret (optional) ---
  const instanceSecret = await promptInstanceSecret(prompter);

  // --- Step 4: Agent selection ---
  const agents = await promptAgents(prompter, cfg);

  // --- Step 5: Default model ---
  const defaultModelId = await promptDefaultModel(prompter);

  // --- Step 6: Assemble config ---
  const nextCfg = applyOpenGramConfig(cfg, {
    baseUrl,
    instanceSecret,
    agents,
    defaultModelId,
  });

  await prompter.note(
    "channels.opengram has been configured.\n" +
      `  baseUrl: ${baseUrl}\n` +
      `  agents: ${agents.length > 0 ? agents.join(", ") : "(all)"}\n` +
      `  defaultModelId: ${defaultModelId}`,
    "Configuration",
  );

  // --- Step 7: Restart prompt ---
  const shouldRestart = await prompter.confirm({
    message: "Restart the gateway now?",
    initialValue: false,
  });

  await prompter.outro("OpenGram setup complete.");

  return { cfg: nextCfg, shouldRestart };
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

async function promptBaseUrl(prompter: WizardPrompter): Promise<string> {
  const tailscaleUrl = detectTailscaleUrl();
  const suggestion = tailscaleUrl ?? "http://localhost:3000";

  const url = await prompter.text({
    message: "OpenGram instance URL",
    initialValue: suggestion,
    placeholder: "http://localhost:3000",
    validate(value) {
      if (!value.trim()) return "URL is required";
      try {
        new URL(value);
      } catch {
        return "Invalid URL";
      }
      return undefined;
    },
  });

  // Strip trailing slash for consistency
  return url.replace(/\/+$/, "");
}

async function testConnection(
  prompter: WizardPrompter,
  baseUrl: string,
): Promise<void> {
  const client = new OpenGramClient(baseUrl);

  while (true) {
    const spin = prompter.progress("Testing connection…");

    try {
      const health = await client.health();
      spin.stop(`Connected to OpenGram v${health.version}`);
      return;
    } catch (error) {
      spin.stop(`Connection failed: ${error}`);

      const retry = await prompter.confirm({
        message:
          "Retry connection test? (If your instance requires a secret, you can skip and provide it in the next step.)",
        initialValue: true,
      });

      if (!retry) {
        await prompter.note(
          "Continuing without a successful connection test.\n" +
            "Make sure OpenGram is running before starting the gateway.",
          "Warning",
        );
        return;
      }
    }
  }
}

async function promptInstanceSecret(
  prompter: WizardPrompter,
): Promise<string | undefined> {
  const usesSecret = await prompter.confirm({
    message: "Does your OpenGram instance use an instance secret?",
    initialValue: false,
  });

  if (!usesSecret) return undefined;

  const secret = await prompter.text({
    message: "Instance secret",
    placeholder: "your-secret-here",
    validate(value) {
      if (!value.trim()) return "Secret cannot be empty";
      return undefined;
    },
  });

  return secret;
}

async function promptAgents(
  prompter: WizardPrompter,
  cfg: OpenClawConfig,
): Promise<string[]> {
  const agentList = (cfg as any).agents?.list as
    | Array<{ id: string; name?: string }>
    | undefined;

  if (!agentList || agentList.length === 0) {
    await prompter.note(
      "No agents found in config. All agents will receive messages.",
      "Agents",
    );
    return [];
  }

  const options = agentList.map((a) => ({
    value: a.id,
    label: a.name ?? a.id,
    hint: a.name ? a.id : undefined,
  }));

  const selected = await prompter.multiselect<string>({
    message: "Which agents should receive messages from OpenGram?",
    options,
    initialValues: agentList.map((a) => a.id),
  });

  return selected;
}

async function promptDefaultModel(prompter: WizardPrompter): Promise<string> {
  return prompter.text({
    message: "Default model for OpenGram chats",
    initialValue: "claude-opus-4-6",
    placeholder: "claude-opus-4-6",
  });
}

// ---------------------------------------------------------------------------
// Config assembly
// ---------------------------------------------------------------------------

export type OpenGramSetupInput = {
  baseUrl: string;
  instanceSecret?: string;
  agents: string[];
  defaultModelId: string;
};

/**
 * Apply wizard answers onto a config object, returning a new config.
 * Does not write to disk — the caller decides persistence.
 */
export function applyOpenGramConfig(
  cfg: OpenClawConfig,
  input: OpenGramSetupInput,
): OpenClawConfig {
  const channels = (cfg.channels ?? {}) as Record<string, any>;

  const opengramSection: Record<string, unknown> = {
    ...channels.opengram,
    enabled: true,
    baseUrl: input.baseUrl,
    agents: input.agents,
    defaultModelId: input.defaultModelId,
  };

  if (input.instanceSecret) {
    opengramSection.instanceSecret = input.instanceSecret;
  } else {
    delete opengramSection.instanceSecret;
  }

  const plugins = (cfg as any).plugins ?? {};
  const entries = plugins.entries ?? {};

  return {
    ...cfg,
    channels: {
      ...channels,
      opengram: opengramSection,
    },
    plugins: {
      ...plugins,
      entries: {
        ...entries,
        "opengram": {
          ...entries["opengram"],
          enabled: true,
        },
      },
    },
  } as OpenClawConfig;
}
