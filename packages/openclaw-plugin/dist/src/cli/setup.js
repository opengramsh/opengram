import { fileURLToPath } from "node:url";
import path from "node:path";
import { OpenGramClient } from "../api-client.js";
import { detectOpengramUrl } from "./tailscale.js";
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/**
 * Run the OpenGram setup wizard.
 *
 * The wizard is framework-agnostic: it accepts a WizardPrompter and returns a
 * modified config object. The caller is responsible for persistence.
 */
export async function runSetupWizard(prompter, cfg, options) {
    await prompter.intro("OpenGram Setup");
    // Extract existing opengram config for pre-populating prompts
    const existing = cfg.channels?.opengram ?? {};
    // --- Step 1: OpenGram URL ---
    let baseUrl;
    if (options?.baseUrl) {
        baseUrl = options.baseUrl.replace(/\/+$/, "");
        await prompter.note(`Using OpenGram URL: ${baseUrl}`, "Pre-filled");
    }
    else {
        baseUrl = await promptBaseUrl(prompter, existing.baseUrl);
    }
    // --- Step 2: Connection test (skip when URL is pre-filled — server may not be running yet) ---
    if (!options?.baseUrl) {
        await testConnection(prompter, baseUrl);
    }
    // --- Step 3: Instance secret (optional) ---
    let instanceSecret;
    if (options?.instanceSecret) {
        instanceSecret = options.instanceSecret;
        await prompter.note("Instance secret pre-filled.", "Pre-filled");
    }
    else if (options?.noInstanceSecret) {
        instanceSecret = undefined;
    }
    else {
        instanceSecret = await promptInstanceSecret(prompter, existing.instanceSecret);
    }
    // --- Step 4: Model selection — disabled (models managed elsewhere) ---
    // const existingModelIds = await fetchExistingModelIds(baseUrl, instanceSecret);
    // const selectedModels = await promptModels(prompter, cfg, existingModelIds);
    // --- Step 5: Agent selection (from OpenClaw config) ---
    const { agentIds, agentConfigs } = await promptAgents(prompter, cfg, existing.agents);
    // --- Step 6: Push to OpenGram ---
    if (agentConfigs.length > 0) {
        const spin = prompter.progress("Pushing config to OpenGram…");
        try {
            await pushToOpenGram(baseUrl, instanceSecret, agentConfigs);
            spin.stop("Config pushed to OpenGram successfully.");
        }
        catch (error) {
            spin.stop(`Failed to push config: ${error}`);
            await prompter.note("Could not update OpenGram config automatically.\n" +
                "Edit opengram.config.json manually to add agents and models.", "Warning");
        }
    }
    // --- Step 7: Assemble openclaw.json config ---
    const nextCfg = applyOpenGramConfig(cfg, {
        baseUrl,
        instanceSecret,
        agents: agentIds,
        pluginDir: PLUGIN_DIR,
    });
    await prompter.note("channels.opengram has been configured.\n" +
        `  baseUrl: ${baseUrl}\n` +
        `  agents: ${agentIds.length > 0 ? agentIds.join(", ") : "(all)"}`, "Configuration");
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
async function promptBaseUrl(prompter, existingUrl) {
    let suggestion;
    if (existingUrl) {
        suggestion = existingUrl;
    }
    else {
        const spin = prompter.progress("Detecting OpenGram instance…");
        try {
            suggestion = await detectOpengramUrl();
            spin.stop(`Detected: ${suggestion}`);
        }
        catch {
            suggestion = "http://localhost:3000";
            spin.stop("Auto-detection failed, using default.");
        }
    }
    const url = await prompter.text({
        message: "OpenGram instance URL",
        initialValue: suggestion,
        placeholder: "http://localhost:3000",
        validate(value) {
            if (!value.trim())
                return "URL is required";
            try {
                new URL(value);
            }
            catch {
                return "Invalid URL";
            }
            return undefined;
        },
    });
    // Strip trailing slash for consistency
    return url.replace(/\/+$/, "");
}
async function testConnection(prompter, baseUrl) {
    const client = new OpenGramClient(baseUrl);
    while (true) {
        const spin = prompter.progress("Testing connection…");
        try {
            const health = await client.health();
            spin.stop(`Connected to OpenGram v${health.version}`);
            return;
        }
        catch (error) {
            spin.stop(`Connection failed: ${error}`);
            const retry = await prompter.confirm({
                message: "Retry connection test? (If your instance requires a secret, you can skip and provide it in the next step.)",
                initialValue: true,
            });
            if (!retry) {
                await prompter.note("Continuing without a successful connection test.\n" +
                    "Make sure OpenGram is running before starting the gateway.", "Warning");
                return;
            }
        }
    }
}
async function promptInstanceSecret(prompter, existingSecret) {
    const usesSecret = await prompter.confirm({
        message: "Does your OpenGram instance use an instance secret?",
        initialValue: Boolean(existingSecret),
    });
    if (!usesSecret)
        return undefined;
    const secret = await prompter.text({
        message: "Instance secret",
        initialValue: existingSecret,
        placeholder: "your-secret-here",
        validate(value) {
            if (!value.trim())
                return "Secret cannot be empty";
            return undefined;
        },
    });
    return secret;
}
async function promptAgents(prompter, cfg, previousAgents) {
    const agentList = cfg.agents?.list;
    if (!agentList || agentList.length === 0) {
        await prompter.note("No agents found in config. All agents will receive messages.", "Agents");
        return { agentIds: [], agentConfigs: [] };
    }
    const options = agentList.map((a) => ({
        value: a.id,
        label: a.name ?? a.id,
        hint: a.name ? a.id : undefined,
    }));
    // Re-running setup: pre-select only previously configured agents
    // (filtered to those that still exist). First-time: select all.
    const validPrevious = previousAgents?.filter((id) => agentList.some((a) => a.id === id)) ?? [];
    const defaultSelection = validPrevious.length > 0
        ? validPrevious
        : agentList.map((a) => a.id);
    const selected = await prompter.multiselect({
        message: "Which agents should receive messages from OpenGram?",
        options,
        initialValues: defaultSelection,
    });
    const agentConfigs = selected.flatMap((id) => {
        const a = agentList.find((item) => item.id === id);
        if (!a)
            return [];
        return [{
                id: a.id,
                name: a.name ?? a.id,
                description: "Imported from OpenClaw",
                ...(a.model ? { defaultModelId: a.model } : {}),
            }];
    });
    return { agentIds: selected, agentConfigs };
}
async function pushToOpenGram(baseUrl, instanceSecret, agents) {
    const headers = { "Content-Type": "application/json" };
    if (instanceSecret) {
        headers.Authorization = `Bearer ${instanceSecret}`;
    }
    const body = {};
    if (agents.length > 0)
        body.agents = agents;
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
/**
 * Apply wizard answers onto a config object, returning a new config.
 * Does not write to disk — the caller decides persistence.
 */
export function applyOpenGramConfig(cfg, input) {
    const channels = (cfg.channels ?? {});
    const opengramSection = {
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
    const existingAllowFrom = Array.isArray(opengramSection.allowFrom)
        ? opengramSection.allowFrom
        : [];
    if (!existingAllowFrom.includes("user:primary")) {
        existingAllowFrom.push("user:primary");
    }
    opengramSection.allowFrom = existingAllowFrom;
    if (input.instanceSecret) {
        opengramSection.instanceSecret = input.instanceSecret;
    }
    else {
        delete opengramSection.instanceSecret;
    }
    // Auto-rename is now managed by Opengram itself — remove any legacy config
    delete opengramSection.autoRename;
    // Set a sensible global session reset default (daily at 4 AM) and override
    // the opengram channel specifically to use a ~100-year idle timeout so chat
    // context persists indefinitely. Only sets defaults if not already configured.
    const existingSession = cfg.session ?? {};
    const existingReset = existingSession.reset;
    const existingResetByChannel = existingSession.resetByChannel ?? {};
    const session = {
        ...existingSession,
        reset: existingReset ?? {
            mode: "daily",
            atHour: 4,
        },
        resetByChannel: {
            ...existingResetByChannel,
            opengram: existingResetByChannel.opengram ?? { mode: "idle", idleMinutes: 52560000 },
        },
    };
    const plugins = cfg.plugins ?? {};
    const entries = plugins.entries ?? {};
    // Ensure the plugin is in plugins.allow (deduplicated)
    const existingAllow = Array.isArray(plugins.allow) ? plugins.allow : [];
    const allow = existingAllow.includes("@opengramsh/openclaw-plugin")
        ? existingAllow
        : [...existingAllow, "@opengramsh/openclaw-plugin"];
    // Ensure the plugin dir is in plugins.load.paths (deduplicated)
    const existingLoad = plugins.load ?? {};
    const existingPaths = Array.isArray(existingLoad.paths) ? existingLoad.paths : [];
    const paths = input.pluginDir && !existingPaths.includes(input.pluginDir)
        ? [...existingPaths, input.pluginDir]
        : existingPaths;
    return {
        ...cfg,
        channels: {
            ...channels,
            opengram: opengramSection,
        },
        plugins: {
            ...plugins,
            allow,
            load: {
                ...existingLoad,
                paths,
            },
            entries: {
                ...entries,
                "@opengramsh/openclaw-plugin": {
                    ...entries["@opengramsh/openclaw-plugin"],
                    enabled: true,
                },
            },
        },
        session,
    };
}
