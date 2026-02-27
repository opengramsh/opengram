import { SectionReveal } from "./SectionReveal";

const rows = [
  {
    discord: "All agents in one shared channel",
    opengram: "Each agent gets its own chat space",
  },
  {
    discord: "One chat per agent — context bleeds across topics",
    opengram: "Multiple parallel chats per agent, each isolated",
  },
  {
    discord: "Markdown in a text box for structured responses",
    opengram: "Native request types: choices, forms, text inputs",
  },
  {
    discord: "Platform you don't control",
    opengram: "Self-hosted, your data, your server",
  },
  {
    discord: "No push for agent-specific actions",
    opengram: "Push notifications including iOS PWA",
  },
  {
    discord: "File uploads are ad-hoc",
    opengram: "First-class media with thumbnail previews",
  },
];

export function ProblemSection() {
  return (
    <section className="py-24 md:py-32 px-4">
      <div className="max-w-4xl mx-auto">
        <SectionReveal>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-8">
            Discord wasn&apos;t built for this.
          </h2>
        </SectionReveal>

        <SectionReveal>
          <p className="text-secondary text-base md:text-lg leading-relaxed max-w-3xl mb-12">
            Discord and Telegram work. They just weren&apos;t built for talking
            to agents. When you have five agents running in the same server,
            things get messy fast. Context leaks between conversations.
            Structured responses become walls of markdown. You&apos;re on
            someone else&apos;s platform. OpenGram is a dedicated interface built
            specifically for agent interactions — nothing more, nothing less.
          </p>
        </SectionReveal>

        <SectionReveal>
          {/* Comparison table */}
          <div className="glass rounded-xl overflow-hidden">
            <div className="grid grid-cols-2 border-b border-line/50">
              <div className="px-4 md:px-6 py-3 text-xs font-mono text-tertiary uppercase tracking-wider">
                Discord / Telegram
              </div>
              <div className="px-4 md:px-6 py-3 text-xs font-mono text-accent uppercase tracking-wider border-l border-line/50 bg-accent/[0.04]">
                OpenGram
              </div>
            </div>
            {rows.map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-2 ${
                  i < rows.length - 1 ? "border-b border-line/30" : ""
                }`}
              >
                <div className="px-4 md:px-6 py-3.5 text-sm text-tertiary leading-snug">
                  {row.discord}
                </div>
                <div className="px-4 md:px-6 py-3.5 text-sm text-primary leading-snug border-l border-line/50 bg-accent/[0.04] flex items-start gap-2">
                  <span className="text-accent text-xs mt-0.5 shrink-0">&#10003;</span>
                  <span>{row.opengram}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
