let runtime = null;
export function setOpenGramRuntime(next) {
    runtime = next;
}
export function getOpenGramRuntime() {
    if (!runtime) {
        throw new Error("OpenGram runtime not initialized");
    }
    return runtime;
}
