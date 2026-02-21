import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setOpenGramRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getOpenGramRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("OpenGram runtime not initialized");
  }
  return runtime;
}
