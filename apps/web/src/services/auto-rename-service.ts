import { validationError } from "@/src/api/http";
import { loadOpengramConfig } from "@/src/config/opengram-config";
import { getDb } from "@/src/db/client";
import { updateChat } from "@/src/services/chats-service";

const RENAME_SYSTEM_PROMPT =
  "You are a chat title generator. Your only job is to output a short title for a conversation — never respond to the conversation itself. Reply with only the title: 3 to 7 words, no quotes, no trailing punctuation.";

const MAX_TITLE_TOKENS = 1000;
const TITLE_MAX_CHARS = 48;
const MESSAGES_FOR_CONTEXT = 6;
const MSG_CONTEXT_MAX_CHARS = 300;
const MIN_USER_CONTENT_CHARS = 30;

// ─── Provider data ────────────────────────────────────────────────────────────

export type RenameProvider = {
  id: "anthropic" | "openai" | "google" | "xai" | "openrouter";
  name: string;
  envVar: string | string[];
  cheapModels: { id: string; label: string }[];
  apiBaseUrl: string;
};

export const RENAME_PROVIDERS: RenameProvider[] = [
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
    cheapModels: [{ id: "gpt-5.4-nano", label: "GPT-5.4 Nano" }],
    apiBaseUrl: "https://api.openai.com",
  },
  {
    id: "google",
    name: "Google Gemini",
    envVar: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    cheapModels: [
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
      {
        id: "gemini-3.1-flash-lite-preview",
        label: "Gemini 3.1 Flash Lite Preview",
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
      { id: "openai/gpt-5.4-nano", label: "GPT-5.4 Nano" },
      { id: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast" },
      {
        id: "google/gemini-3.1-flash-lite-preview",
        label: "Gemini 3.1 Flash Lite Preview",
      },
      { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    ],
    apiBaseUrl: "https://openrouter.ai",
  },
];

export function getProviderById(id: string): RenameProvider | undefined {
  return RENAME_PROVIDERS.find((p) => p.id === id);
}

export function resolveApiKey(
  provider: RenameProvider,
  configApiKey?: string,
): string | undefined {
  if (configApiKey) return configApiKey;
  const vars = Array.isArray(provider.envVar)
    ? provider.envVar
    : [provider.envVar];
  for (const varName of vars) {
    const val = process.env[varName];
    if (val) return val;
  }
  return undefined;
}

export function detectEnvApiKey(provider: RenameProvider): boolean {
  const vars = Array.isArray(provider.envVar)
    ? provider.envVar
    : [provider.envVar];
  return vars.some((v) => Boolean(process.env[v]));
}

export function getEnvVarName(provider: RenameProvider): string {
  return Array.isArray(provider.envVar) ? provider.envVar[0] : provider.envVar;
}

// ─── API call functions ───────────────────────────────────────────────────────

async function callAnthropic(
  apiKey: string,
  modelId: string,
  conversationText: string,
): Promise<string> {
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
      messages: [
        {
          role: "user",
          content: `Conversation to title:\n\n${conversationText}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) throw new Error("Anthropic returned empty content");
  return text;
}

async function callOpenAICompat(
  endpoint: string,
  apiKey: string,
  modelId: string,
  conversationText: string,
): Promise<string> {
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
        {
          role: "user",
          content: `Conversation to title:\n\n${conversationText}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string | null } }>;
    output?: Array<{
      type: string;
      content?: Array<{ type: string; text: string }>;
    }>;
  };
  const outputText = data.output
    ?.find((o) => o.type === "message")
    ?.content?.find((c) => c.type === "output_text" || c.type === "text")
    ?.text?.trim();
  if (outputText) return outputText;
  const raw = data.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw.trim() : undefined;
  if (!text) throw new Error("Provider returned empty content");
  return text;
}

async function callGoogle(
  apiKey: string,
  modelId: string,
  conversationText: string,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: RENAME_SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [{ text: `Conversation to title:\n\n${conversationText}` }],
        },
      ],
      generationConfig: { maxOutputTokens: MAX_TITLE_TOKENS },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Google returned empty content");
  return text;
}

// ─── Key validation ───────────────────────────────────────────────────────────

export async function validateAutoRenameKey(
  providerId: RenameProvider["id"],
  modelId: string,
  apiKey: string,
): Promise<void> {
  try {
    switch (providerId) {
      case "anthropic": {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: 1,
            messages: [{ role: "user", content: "Hi" }],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status === 401 || res.status === 403) {
            throw validationError(
              `Authentication failed: invalid API key. (${res.status})`,
            );
          }
          if (res.status === 404) {
            throw validationError(
              `Model "${modelId}" not found. (${res.status}): ${body}`,
            );
          }
          throw validationError(`Anthropic API error (${res.status}): ${body}`);
        }
        break;
      }
      case "openai":
      case "xai":
      case "openrouter": {
        const endpoints: Record<string, string> = {
          openai: "https://api.openai.com/v1/chat/completions",
          xai: "https://api.x.ai/v1/chat/completions",
          openrouter: "https://openrouter.ai/api/v1/chat/completions",
        };
        const res = await fetch(endpoints[providerId], {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelId,
            max_completion_tokens: 1,
            messages: [{ role: "user", content: "Hi" }],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status === 401 || res.status === 403) {
            throw validationError(
              `Authentication failed: invalid API key. (${res.status})`,
            );
          }
          if (res.status === 404) {
            throw validationError(
              `Model "${modelId}" not found. (${res.status}): ${body}`,
            );
          }
          throw validationError(`API error (${res.status}): ${body}`);
        }
        break;
      }
      case "google": {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "Hi" }] }],
            generationConfig: { maxOutputTokens: 1 },
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status === 401 || res.status === 403) {
            throw validationError(
              `Authentication failed: invalid API key. (${res.status})`,
            );
          }
          if (res.status === 404) {
            throw validationError(
              `Model "${modelId}" not found. (${res.status}): ${body}`,
            );
          }
          throw validationError(`Google API error (${res.status}): ${body}`);
        }
        break;
      }
      default:
        throw validationError(`Unknown provider: ${providerId}`);
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) throw err; // re-throw ApiError
    throw validationError(
      err instanceof Error
        ? err.message
        : `Failed to validate API key: ${String(err)}`,
    );
  }
}

async function generateTitle(params: {
  provider: RenameProvider["id"];
  modelId: string;
  apiKey: string;
  conversationText: string;
}): Promise<string> {
  const { provider, modelId, apiKey, conversationText } = params;

  switch (provider) {
    case "anthropic":
      return callAnthropic(apiKey, modelId, conversationText);
    case "openai":
      return callOpenAICompat(
        "https://api.openai.com/v1/chat/completions",
        apiKey,
        modelId,
        conversationText,
      );
    case "xai":
      return callOpenAICompat(
        "https://api.x.ai/v1/chat/completions",
        apiKey,
        modelId,
        conversationText,
      );
    case "openrouter":
      return callOpenAICompat(
        "https://openrouter.ai/api/v1/chat/completions",
        apiKey,
        modelId,
        conversationText,
      );
    case "google":
      return callGoogle(apiKey, modelId, conversationText);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ─── Core function ────────────────────────────────────────────────────────────

export async function maybeAutoRenameChat(chatId: string): Promise<void> {
  try {
    const config = loadOpengramConfig();
    const ar = config.autoRename;
    if (!ar?.enabled) return;
    if (!ar.provider || !ar.modelId) return;

    const provider = getProviderById(ar.provider);
    if (!provider) return;

    const apiKey = resolveApiKey(provider, ar.apiKey);
    if (!apiKey) return;

    const db = getDb();

    // Check if chat still has default title
    const chat = db
      .prepare("SELECT title_source FROM chats WHERE id = ?")
      .get(chatId) as { title_source: string } | undefined;
    if (!chat || chat.title_source !== "default") return;

    // Fetch last 6 user/agent messages
    const messages = db
      .prepare(
        [
          "SELECT role, content_final FROM messages",
          "WHERE chat_id = ? AND role IN ('user', 'agent')",
          "ORDER BY created_at ASC",
          "LIMIT ?",
        ].join(" "),
      )
      .all(chatId, MESSAGES_FOR_CONTEXT) as Array<{
      role: string;
      content_final: string | null;
    }>;

    if (messages.length === 0) return;

    // Build conversation text
    const conversationText = messages
      .map((m) => {
        const role = m.role === "user" ? "User" : "Assistant";
        const text = m.content_final?.trim() ?? "";
        const truncated =
          text.length > MSG_CONTEXT_MAX_CHARS
            ? text.slice(0, MSG_CONTEXT_MAX_CHARS) + "…"
            : text;
        return `${role}: ${truncated}`;
      })
      .join("\n");

    if (!conversationText.trim()) return;

    // Skip if user hasn't said enough
    const userContentLength = messages
      .filter((m) => m.role === "user")
      .reduce((sum, m) => sum + (m.content_final?.trim().length ?? 0), 0);
    if (userContentLength < MIN_USER_CONTENT_CHARS) return;

    // Generate and apply title
    const rawTitle = await generateTitle({
      provider: ar.provider,
      modelId: ar.modelId,
      apiKey,
      conversationText,
    });

    const title = rawTitle.trim().slice(0, TITLE_MAX_CHARS);
    if (!title) return;

    updateChat(chatId, { title, titleAutoRenamed: true });
    console.log(`[auto-rename] Renamed chat ${chatId} to "${title}"`);
  } catch (err) {
    console.warn(`[auto-rename] Failed for chat ${chatId}: ${String(err)}`);
  }
}
