import { SectionReveal } from "./SectionReveal";

export function OpenClawSection() {
  return (
    <section className="py-24 md:py-32 px-4">
      <div className="max-w-4xl mx-auto">
        <SectionReveal>
          <p className="font-mono text-xs text-accent uppercase tracking-widest mb-4">
            $ openclaw plugin install opengram
          </p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            One command to connect your agents.
          </h2>
          <p className="text-secondary text-base md:text-lg leading-relaxed max-w-2xl mb-10">
            OpenGram ships an official{" "}
            <a
              href="https://openclaw.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              OpenClaw
            </a>{" "}
            plugin. Agents connected through OpenClaw get dedicated chats,
            structured requests, and streaming — automatically.
          </p>
        </SectionReveal>

        <SectionReveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Install command */}
            <div className="glass rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line/30 flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                </div>
                <span className="font-mono text-xs text-tertiary ml-2">
                  terminal
                </span>
              </div>
              <div className="px-4 py-4 bg-code space-y-2">
                <p className="font-mono text-sm text-secondary">
                  <span className="text-tertiary select-none">$ </span>
                  <span className="text-primary">
                    openclaw plugin install opengram
                  </span>
                </p>
                <p className="font-mono text-xs text-success">
                  ✓ Plugin installed
                </p>
                <p className="font-mono text-sm text-secondary">
                  <span className="text-tertiary select-none">$ </span>
                  <span className="text-primary">openclaw plugin setup opengram</span>
                </p>
                <p className="font-mono text-xs text-secondary">
                  OpenGram URL:{" "}
                  <span className="text-primary">
                    https://opengram.tail1234.ts.net
                  </span>
                </p>
                <p className="font-mono text-xs text-secondary">
                  API key:{" "}
                  <span className="text-primary">og_••••••••</span>
                </p>
                <p className="font-mono text-xs text-success">
                  ✓ Connected. 3 agents synced.
                </p>
              </div>
            </div>

            {/* Config snippet */}
            <div className="glass rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line/30 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success/60" />
                <span className="font-mono text-xs text-tertiary">
                  openclaw.config.json
                </span>
              </div>
              <pre className="px-4 py-4 text-sm font-mono overflow-x-auto text-secondary leading-relaxed bg-code">
                <code>{`{
  "plugins": {
    "opengram": {
      "url": "https://opengram.tail1234.ts.net",
      "apiKey": "$OPENGRAM_API_KEY",
      "autoSync": true
    }
  }
}`}</code>
              </pre>
            </div>
          </div>
        </SectionReveal>

        <SectionReveal>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-secondary">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Dedicated chats per agent
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Structured request cards
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Real-time streaming
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Or use any HTTP client
            </span>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
