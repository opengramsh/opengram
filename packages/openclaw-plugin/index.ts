import type { OpenClawPluginDefinition } from "openclaw/plugin-sdk";

import { opengramPlugin } from "./src/channel.js";
import { setOpenGramRuntime } from "./src/runtime.js";

const plugin: OpenClawPluginDefinition = {
  id: "opengram",
  name: "openclaw-plugin-opengram",
  version: "0.1.0",
  description: "OpenGram channel plugin - mobile-first AI agent chat interface",
  register(api) {
    setOpenGramRuntime(api.runtime);
    api.registerChannel({ plugin: opengramPlugin });
    api.logger.info("OpenGram channel plugin loaded");
  },
};

export default plugin;
