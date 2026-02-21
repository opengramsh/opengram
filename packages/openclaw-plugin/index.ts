import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { opengramPlugin } from "./src/channel.js";
import { registerOpengramCli } from "./src/cli/register.js";
import { setOpenGramRuntime } from "./src/runtime.js";

const plugin = {
  id: "opengram",
  name: "opengram",
  version: "0.1.0",
  description: "OpenGram channel plugin - mobile-first AI agent chat interface",
  register(api: OpenClawPluginApi) {
    setOpenGramRuntime(api.runtime);
    api.registerChannel(opengramPlugin);
    registerOpengramCli(api);
    api.logger.info("OpenGram channel plugin loaded");
  },
};

export default plugin;
