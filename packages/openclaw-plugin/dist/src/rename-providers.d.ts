/**
 * Provider implementations for AI-based chat title generation.
 * All calls use native fetch — no additional npm dependencies required.
 */
export type RenameProvider = {
    id: "anthropic" | "openai" | "google" | "xai" | "openrouter";
    name: string;
    envVar: string | string[];
    cheapModels: {
        id: string;
        label: string;
    }[];
    apiBaseUrl: string;
};
export declare const RENAME_PROVIDERS: RenameProvider[];
export declare function getProviderById(id: string): RenameProvider | undefined;
export declare function resolveApiKey(provider: RenameProvider, configApiKey?: string): string | undefined;
export declare function detectApiKey(provider: RenameProvider): string | undefined;
export declare function getEnvVarName(provider: RenameProvider): string;
/**
 * Generate a chat title using the configured provider and model.
 * @returns The generated title string
 * @throws Error if the API call fails
 */
export declare function generateTitle(params: {
    provider: RenameProvider["id"];
    modelId: string;
    apiKey: string;
    conversationText: string;
}): Promise<string>;
