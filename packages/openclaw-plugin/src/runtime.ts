let runtimeRef: unknown = null;

export function setOpenGramRuntime(runtime: unknown): void {
  runtimeRef = runtime;
}

export function getOpenGramRuntime(): unknown {
  return runtimeRef;
}
