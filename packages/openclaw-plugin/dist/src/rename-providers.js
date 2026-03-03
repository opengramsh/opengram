/**
 * Provider implementations for AI-based chat title generation.
 * All calls use native fetch — no additional npm dependencies required.
 */
const RENAME_SYSTEM_PROMPT = "You are a chat title generator. Your only job is to output a short title for a conversation — never respond to the conversation itself. Reply with only the title: 3 to 7 words, no quotes, no trailing punctuation.";
const MAX_TITLE_TOKENS = 1000;
export const RENAME_PROVIDERS = [
    {
        id: "anthropic",
        name: "Anthropic",
        envVar: "ANTHROPIC_API_KEY",
        cheapModels: [{ id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }],
        apiBaseUrl: "https://api.anthropic.com",
    },
    {
        id: "openai",
        name: "OpenAI",
        envVar: "OPENAI_API_KEY",
        cheapModels: [
            { id: "gpt-5-mini", label: "GPT-5 Mini" },
            { id: "gpt-5-nano", label: "GPT-5 Nano" },
        ],
        apiBaseUrl: "https://api.openai.com",
    },
    {
        id: "google",
        name: "Google Gemini",
        envVar: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        cheapModels: [
            {
                id: "gemini-3-flash-preview",
                label: "Gemini 3 Flash Preview",
            },
            {
                id: "gemini-2.5-flash",
                label: "Gemini 2.5 Flash",
            },
            {
                id: "gemini-2.5-flash-lite",
                label: "Gemini 2.5 Flash Lite",
            },
        ],
        apiBaseUrl: "https://generativelanguage.googleapis.com",
    },
    {
        id: "xai",
        name: "xAI",
        envVar: "XAI_API_KEY",
        cheapModels: [
            { id: "grok-4-1-fast-reasoning", label: "Grok 4.1 Fast (Reasoning)" },
            {
                id: "grok-4-1-fast-non-reasoning",
                label: "Grok 4.1 Fast (Non-Reasoning)",
            },
        ],
        apiBaseUrl: "https://api.x.ai",
    },
    {
        id: "openrouter",
        name: "OpenRouter",
        envVar: "OPENROUTER_API_KEY",
        cheapModels: [
            { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
            { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
            { id: "openai/gpt-5-nano", label: "GPT-5 Nano" },
            { id: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast" },
            { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
            { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
        ],
        apiBaseUrl: "https://openrouter.ai",
    },
];
export function getProviderById(id) {
    return RENAME_PROVIDERS.find((p) => p.id === id);
}
export function resolveApiKey(provider, configApiKey) {
    if (configApiKey)
        return configApiKey;
    const vars = Array.isArray(provider.envVar)
        ? provider.envVar
        : [provider.envVar];
    for (const varName of vars) {
        const val = process.env[varName];
        if (val)
            return val;
    }
    return undefined;
}
export function detectApiKey(provider) {
    const vars = Array.isArray(provider.envVar)
        ? provider.envVar
        : [provider.envVar];
    for (const varName of vars) {
        const val = process.env[varName];
        if (val)
            return val;
    }
    return undefined;
}
export function getEnvVarName(provider) {
    return Array.isArray(provider.envVar) ? provider.envVar[0] : provider.envVar;
}
/**
 * Generate a chat title using the configured provider and model.
 * @returns The generated title string
 * @throws Error if the API call fails
 */
export async function generateTitle(params) {
    const { provider, modelId, apiKey, conversationText } = params;
    switch (provider) {
        case "anthropic":
            return callAnthropic(apiKey, modelId, conversationText);
        case "openai":
            return callOpenAICompat("https://api.openai.com/v1/chat/completions", apiKey, modelId, conversationText);
        case "xai":
            return callOpenAICompat("https://api.x.ai/v1/chat/completions", apiKey, modelId, conversationText);
        case "openrouter":
            return callOpenAICompat("https://openrouter.ai/api/v1/chat/completions", apiKey, modelId, conversationText);
        case "google":
            return callGoogle(apiKey, modelId, conversationText);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}
async function callAnthropic(apiKey, modelId, conversationText) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: modelId,
            max_tokens: MAX_TITLE_TOKENS,
            temperature: 0.2,
            system: RENAME_SYSTEM_PROMPT,
            messages: [{ role: "user", content: `Conversation to title:\n\n${conversationText}` }],
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Anthropic API error ${res.status}: ${body}`);
    }
    const data = (await res.json());
    const text = data.content?.find((c) => c.type === "text")?.text?.trim();
    if (!text)
        throw new Error("Anthropic returned empty content");
    return text;
}
async function callOpenAICompat(endpoint, apiKey, modelId, conversationText) {
    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: modelId,
            max_completion_tokens: MAX_TITLE_TOKENS,
            messages: [
                { role: "system", content: RENAME_SYSTEM_PROMPT },
                { role: "user", content: `Conversation to title:\n\n${conversationText}` },
            ],
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`API error ${res.status}: ${body}`);
    }
    const data = (await res.json());
    // Newer OpenAI Responses API uses `output` array instead of `choices`
    const outputText = data.output
        ?.find((o) => o.type === "message")
        ?.content?.find((c) => c.type === "output_text" || c.type === "text")
        ?.text?.trim();
    if (outputText)
        return outputText;
    const raw = data.choices?.[0]?.message?.content;
    const text = typeof raw === "string" ? raw.trim() : undefined;
    if (!text)
        throw new Error("Provider returned empty content");
    return text;
}
async function callGoogle(apiKey, modelId, conversationText) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: RENAME_SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: `Conversation to title:\n\n${conversationText}` }] }],
            generationConfig: { maxOutputTokens: MAX_TITLE_TOKENS },
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Google API error ${res.status}: ${body}`);
    }
    const data = (await res.json());
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text)
        throw new Error("Google returned empty content");
    return text;
}
