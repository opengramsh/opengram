import type { OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk";

import { OpenGramClient } from "../api-client.js";
import { detectTailscaleUrl } from "./tailscale.js";

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

  // --- Step 4: Model selection (from OpenClaw config) ---
  const selectedModels = await promptModels(prompter, cfg);

  // --- Step 5: Agent selection (from OpenClaw config) ---
  const { agentIds, agentConfigs } = await promptAgents(prompter, cfg);

  // --- Step 6: Push to OpenGram ---
  if (selectedModels.length > 0 || agentConfigs.length > 0) {
    const spin = prompter.progress("Pushing config to OpenGram…");
    try {
      await pushToOpenGram(baseUrl, instanceSecret, agentConfigs, selectedModels);
      spin.stop("Config pushed to OpenGram successfully.");
    } catch (error) {
      spin.stop(`Failed to push config: ${error}`);
      await prompter.note(
        "Could not update OpenGram config automatically.\n" +
          "Edit opengram.config.json manually to add agents and models.",
        "Warning",
      );
    }
  }

  // --- Step 7: Assemble openclaw.json config ---
  const nextCfg = applyOpenGramConfig(cfg, {
    baseUrl,
    instanceSecret,
    agents: agentIds,
  });

  await prompter.note(
    "channels.opengram has been configured.\n" +
      `  baseUrl: ${baseUrl}\n` +
      `  agents: ${agentIds.length > 0 ? agentIds.join(", ") : "(all)"}`,
    "Configuration",
  );

  // --- Step 8: Restart prompt ---
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

type ImportedModel = { id: string; name: string; description: string };

async function promptModels(
  prompter: WizardPrompter,
  cfg: OpenClawConfig,
): Promise<ImportedModel[]> {
  // Models live at agents.defaults.models as Record<id, { alias? }>
  const modelsRecord = (cfg as any).agents?.defaults?.models as
    | Record<string, { alias?: string }>
    | undefined;

  if (!modelsRecord || Object.keys(modelsRecord).length === 0) {
    await prompter.note(
      "No models found in OpenClaw config. Add models to opengram.config.json manually.",
      "Models",
    );
    return [];
  }

  const modelIds = Object.keys(modelsRecord);

  const options = modelIds.map((id) => {
    const alias = modelsRecord[id]?.alias;
    return {
      value: id,
      label: alias ? `${alias} (${id})` : id,
    };
  });

  const selected = await prompter.multiselect<string>({
    message: "Which models should be available in OpenGram?",
    options,
    initialValues: modelIds,
  });

  return selected.map((id) => {
    const alias = modelsRecord[id]?.alias;
    return {
      id,
      name: alias ? `${alias} (${id})` : id,
      description: "",
    };
  });
}

type ImportedAgent = { id: string; name: string; description: string; defaultModelId?: string };

async function promptAgents(
  prompter: WizardPrompter,
  cfg: OpenClawConfig,
): Promise<{ agentIds: string[]; agentConfigs: ImportedAgent[] }> {
  const agentList = (cfg as any).agents?.list as
    | Array<{ id: string; name?: string; model?: string }>
    | undefined;

  if (!agentList || agentList.length === 0) {
    await prompter.note(
      "No agents found in config. All agents will receive messages.",
      "Agents",
    );
    return { agentIds: [], agentConfigs: [] };
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

  const agentConfigs: ImportedAgent[] = selected.map((id) => {
    const a = agentList.find((item) => item.id === id)!;
    return {
      id: a.id,
      name: a.name ?? a.id,
      description: "Imported from OpenClaw",
      ...(a.model ? { defaultModelId: a.model } : {}),
    };
  });

  return { agentIds: selected, agentConfigs };
}

async function pushToOpenGram(
  baseUrl: string,
  instanceSecret: string | undefined,
  agents: ImportedAgent[],
  models: ImportedModel[],
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (instanceSecret) {
    headers.Authorization = `Bearer ${instanceSecret}`;
  }

  const body: Record<string, unknown> = {};
  if (agents.length > 0) body.agents = agents;
  if (models.length > 0) body.models = models;

  const res = await fetch(`${baseUrl}/api/v1/config/admin`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status));
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Config assembly
// ---------------------------------------------------------------------------

export type OpenGramSetupInput = {
  baseUrl: string;
  instanceSecret?: string;
  agents: string[];
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
  };

  // Remove legacy defaultModelId if present
  delete opengramSection.defaultModelId;

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
