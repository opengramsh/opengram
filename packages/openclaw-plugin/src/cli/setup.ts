import type { OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk";

import { OpenGramClient } from "../api-client.js";
import type { AutoRenameConfig } from "../config.js";
import { RENAME_PROVIDERS, detectApiKey, getEnvVarName } from "../rename-providers.js";
import { detectOpengramUrl } from "./tailscale.js";

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

  // Extract existing opengram config for pre-populating prompts
  const existing =
    ((cfg.channels as Record<string, any> | undefined)?.opengram as {
      baseUrl?: string;
      instanceSecret?: string;
      agents?: string[];
      autoRename?: AutoRenameConfig;
    } | undefined) ?? {};

  // --- Step 1: OpenGram URL ---
  const baseUrl = await promptBaseUrl(prompter, existing.baseUrl);

  // --- Step 2: Connection test ---
  await testConnection(prompter, baseUrl);

  // --- Step 3: Instance secret (optional) ---
  const instanceSecret = await promptInstanceSecret(prompter, existing.instanceSecret);

  // --- Step 4: Model selection — disabled (models managed elsewhere) ---
  // const existingModelIds = await fetchExistingModelIds(baseUrl, instanceSecret);
  // const selectedModels = await promptModels(prompter, cfg, existingModelIds);

  // --- Step 5: Agent selection (from OpenClaw config) ---
  const { agentIds, agentConfigs } = await promptAgents(prompter, cfg, existing.agents);

  // --- Step 5b: Auto-rename configuration ---
  const autoRename = await promptAutoRename(prompter, existing.autoRename);

  // --- Step 6: Push to OpenGram ---
  if (agentConfigs.length > 0) {
    const spin = prompter.progress("Pushing config to OpenGram…");
    try {
      await pushToOpenGram(baseUrl, instanceSecret, agentConfigs);
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
    autoRename,
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

async function promptBaseUrl(
  prompter: WizardPrompter,
  existingUrl?: string,
): Promise<string> {
  let suggestion: string;

  if (existingUrl) {
    suggestion = existingUrl;
  } else {
    const spin = prompter.progress("Detecting OpenGram instance…");
    try {
      suggestion = await detectOpengramUrl();
      spin.stop(`Detected: ${suggestion}`);
    } catch {
      suggestion = "http://localhost:3000";
      spin.stop("Auto-detection failed, using default.");
    }
  }

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
  existingSecret?: string,
): Promise<string | undefined> {
  const usesSecret = await prompter.confirm({
    message: "Does your OpenGram instance use an instance secret?",
    initialValue: Boolean(existingSecret),
  });

  if (!usesSecret) return undefined;

  const secret = await prompter.text({
    message: "Instance secret",
    initialValue: existingSecret,
    placeholder: "your-secret-here",
    validate(value) {
      if (!value.trim()) return "Secret cannot be empty";
      return undefined;
    },
  });

  return secret;
}

// Model selection functions — commented out while feature is disabled
//
// async function fetchExistingModelIds(
//   baseUrl: string,
//   instanceSecret: string | undefined,
// ): Promise<string[]> {
//   try {
//     const headers: Record<string, string> = {};
//     if (instanceSecret) {
//       headers.Authorization = `Bearer ${instanceSecret}`;
//     }
//     const res = await fetch(`${baseUrl}/api/v1/config`, {
//       method: "GET",
//       headers,
//     });
//     if (!res.ok) return [];
//     const body = (await res.json()) as { models?: Array<{ id: string }> };
//     return body.models?.map((m) => m.id) ?? [];
//   } catch {
//     return [];
//   }
// }
//
// type ImportedModel = { id: string; name: string; description: string };
//
// async function promptModels(
//   prompter: WizardPrompter,
//   cfg: OpenClawConfig,
//   existingModelIds?: string[],
// ): Promise<ImportedModel[]> {
//   // Models live at agents.defaults.models as Record<id, { alias? }>
//   const modelsRecord = (cfg as any).agents?.defaults?.models as
//     | Record<string, { alias?: string }>
//     | undefined;
//
//   if (!modelsRecord || Object.keys(modelsRecord).length === 0) {
//     await prompter.note(
//       "No models found in OpenClaw config. Add models to opengram.config.json manually.",
//       "Models",
//     );
//     return [];
//   }
//
//   const modelIds = Object.keys(modelsRecord);
//
//   const options = modelIds.map((id) => {
//     const alias = modelsRecord[id]?.alias;
//     return {
//       value: id,
//       label: alias ? `${alias} (${id})` : id,
//     };
//   });
//
//   // Re-running setup: pre-select only models already in OpenGram.
//   // First-time: select all.
//   const validExisting =
//     existingModelIds?.filter((id) => modelIds.includes(id)) ?? [];
//   const defaultSelection =
//     validExisting.length > 0 ? validExisting : modelIds;
//
//   const selected = await prompter.multiselect<string>({
//     message: "Which models should be available in OpenGram?",
//     options,
//     initialValues: defaultSelection,
//   });
//
//   return selected.map((id) => {
//     const alias = modelsRecord[id]?.alias;
//     return {
//       id,
//       name: alias ? `${alias} (${id})` : id,
//       description: "",
//     };
//   });
// }

// type ImportedModel = { id: string; name: string; description: string };

type ImportedAgent = { id: string; name: string; description: string; defaultModelId?: string };

async function promptAgents(
  prompter: WizardPrompter,
  cfg: OpenClawConfig,
  previousAgents?: string[],
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

  // Re-running setup: pre-select only previously configured agents
  // (filtered to those that still exist). First-time: select all.
  const validPrevious =
    previousAgents?.filter((id) => agentList.some((a) => a.id === id)) ?? [];
  const defaultSelection =
    validPrevious.length > 0
      ? validPrevious
      : agentList.map((a) => a.id);

  const selected = await prompter.multiselect<string>({
    message: "Which agents should receive messages from OpenGram?",
    options,
    initialValues: defaultSelection,
  });

  const agentConfigs: ImportedAgent[] = selected.flatMap((id) => {
    const a = agentList.find((item) => item.id === id);
    if (!a) return [];
    return [{
      id: a.id,
      name: a.name ?? a.id,
      description: "Imported from OpenClaw",
      ...(a.model ? { defaultModelId: a.model } : {}),
    }];
  });

  return { agentIds: selected, agentConfigs };
}

async function promptAutoRename(
  prompter: WizardPrompter,
  existing?: AutoRenameConfig,
): Promise<AutoRenameConfig | undefined> {
  const enabled = await prompter.confirm({
    message: "Enable automatic chat renaming? (Uses a cheap AI model to title new chats after the first exchange)",
    initialValue: existing?.enabled ?? false,
  });

  if (!enabled) return undefined;

  // --- Provider selection ---
  const providerOptions = RENAME_PROVIDERS.map((p) => {
    const hasEnvKey = !!detectApiKey(p);
    const hasConfigKey = p.id === existing?.provider && !!existing?.apiKey;
    const detected = hasEnvKey || hasConfigKey;
    return {
      value: p.id,
      label: p.name,
      hint: detected ? "API key detected ✓" : "no API key found",
    };
  });

  // Default to existing provider, or the first one with a detected key, or the first overall.
  const defaultProvider =
    existing?.provider ??
    RENAME_PROVIDERS.find((p) => detectApiKey(p) || (p.id === existing?.provider && !!existing?.apiKey))?.id ??
    RENAME_PROVIDERS[0].id;

  const providerId = await prompter.select<typeof RENAME_PROVIDERS[number]["id"]>({
    message: "Which AI provider should be used for renaming chats?",
    options: providerOptions,
    initialValue: defaultProvider,
  });

  const provider = RENAME_PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return undefined;

  // --- API key ---
  const envKey = detectApiKey(provider);
  const configKey = existing?.provider === providerId ? existing?.apiKey : undefined;
  const detectedKey = envKey ?? configKey;
  let apiKey: string | undefined;

  if (detectedKey) {
    const keySourceMsg = envKey
      ? `${getEnvVarName(provider)} detected in environment`
      : "API key found in existing config";
    const useExistingKey = await prompter.confirm({
      message: `${keySourceMsg}. Use this key for renaming?`,
      initialValue: true,
    });

    if (!useExistingKey) {
      apiKey = await prompter.text({
        message: `Enter your ${provider.name} API key`,
        placeholder: "sk-...",
        validate(value) {
          if (!value.trim()) return "API key cannot be empty";
          return undefined;
        },
      });
    } else if (configKey && !envKey) {
      // Key came from config — persist it again so it isn't lost
      apiKey = configKey;
    }
    // If envKey was used, apiKey stays undefined (use env var at runtime)
  } else {
    await prompter.note(
      `No ${getEnvVarName(provider)} found in environment.\nYou can provide a key now, or set the environment variable before starting the gateway.`,
      `${provider.name} API Key`,
    );
    apiKey = await prompter.text({
      message: `Enter your ${provider.name} API key`,
      placeholder: "sk-...",
      validate(value) {
        if (!value.trim()) return "API key cannot be empty";
        return undefined;
      },
    });
  }

  // --- Model selection ---
  const MANUAL_ENTRY_VALUE = "__manual__";
  const modelOptions = [
    ...provider.cheapModels.map((m) => ({ value: m.id, label: m.label })),
    { value: MANUAL_ENTRY_VALUE, label: "Enter model ID manually" },
  ];

  const defaultModel =
    existing?.provider === providerId && existing?.modelId
      ? existing.modelId
      : provider.cheapModels[0]?.id ?? MANUAL_ENTRY_VALUE;

  const selectedModel = await prompter.select<string>({
    message: `Which model should be used for renaming? (${provider.name})`,
    options: modelOptions,
    initialValue: modelOptions.some((o) => o.value === defaultModel)
      ? defaultModel
      : modelOptions[0].value,
  });

  let modelId: string;
  if (selectedModel === MANUAL_ENTRY_VALUE) {
    modelId = await prompter.text({
      message: `Enter the exact model ID for ${provider.name}`,
      placeholder: provider.cheapModels[0]?.id ?? "",
      validate(value) {
        if (!value.trim()) return "Model ID cannot be empty";
        return undefined;
      },
    });
  } else {
    modelId = selectedModel;
  }

  return {
    enabled: true,
    provider: providerId,
    modelId,
    ...(apiKey ? { apiKey } : {}),
  };
}

async function pushToOpenGram(
  baseUrl: string,
  instanceSecret: string | undefined,
  agents: ImportedAgent[],
  // models: ImportedModel[],
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (instanceSecret) {
    headers.Authorization = `Bearer ${instanceSecret}`;
  }

  const body: Record<string, unknown> = {};
  if (agents.length > 0) body.agents = agents;
  // if (models.length > 0) body.models = models;

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
  autoRename?: AutoRenameConfig;
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
    dmPolicy: "pairing",
  };

  // Remove legacy fields from previous setup versions
  delete opengramSection.defaultModelId;

  // Ensure user:primary is always in the config-level allowFrom so the
  // owner is never blocked by the pairing policy, even when the pairing
  // store lookup is unavailable at runtime.
  const existingAllowFrom: string[] = Array.isArray(opengramSection.allowFrom)
    ? opengramSection.allowFrom
    : [];
  if (!existingAllowFrom.includes("user:primary")) {
    existingAllowFrom.push("user:primary");
  }
  opengramSection.allowFrom = existingAllowFrom;

  if (input.instanceSecret) {
    opengramSection.instanceSecret = input.instanceSecret;
  } else {
    delete opengramSection.instanceSecret;
  }

  if (input.autoRename?.enabled) {
    opengramSection.autoRename = input.autoRename;
  } else {
    delete opengramSection.autoRename;
  }

  // Disable the default daily 4 AM session reset so chat context persists
  // indefinitely. Uses idle mode with a ~100-year timeout since "never" is
  // not a valid mode. Only sets the default if the user hasn't already
  // configured a custom session reset policy.
  const existingSession = (cfg as any).session ?? {};
  const existingReset = existingSession.reset;
  const session = {
    ...existingSession,
    reset: existingReset ?? {
      mode: "idle",
      idleMinutes: 52560000,
    },
  };
  // Clean up legacy invalid keys that older versions may have written.
  delete (session as any).resetByChannel;

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
        "openclaw-plugin-opengram": {
          ...entries["openclaw-plugin-opengram"],
          enabled: true,
        },
      },
    },
    session,
  } as OpenClawConfig;
}
