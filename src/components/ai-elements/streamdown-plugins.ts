import { useEffect, useState } from "react";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import type { MathPlugin, DiagramPlugin } from "streamdown";

type StreamdownPlugins = {
  cjk: typeof cjk;
  code: typeof code;
  math?: MathPlugin;
  mermaid?: DiagramPlugin;
};

let plugins: StreamdownPlugins = { cjk, code };
let listeners: Array<() => void> = [];
let loaded = false;

function loadOptionalPlugins() {
  if (loaded) return;
  loaded = true;
  Promise.all([
    import("@streamdown/math").then((m) => m.math),
    import("@streamdown/mermaid").then((m) => m.mermaid),
  ]).then(([math, mermaid]) => {
    plugins = { ...plugins, math, mermaid };
    for (const fn of listeners) fn();
    listeners = [];
  });
}

export function useStreamdownPlugins() {
  const [current, setCurrent] = useState(plugins);
  useEffect(() => {
    loadOptionalPlugins();
    if (!plugins.math) {
      const listener = () => setCurrent({ ...plugins });
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    }
  }, []);
  return current;
}
