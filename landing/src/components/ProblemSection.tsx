import { SectionReveal } from "./SectionReveal";

const rows = [
  {
    label: "Channels",
    discord: "Shared channel",
    opengram: "Dedicated per agent",
  },
  {
    label: "Context",
    discord: "Bleeds across topics",
    opengram: "Parallel chats, isolated",
  },
  {
    label: "Responses",
    discord: "Markdown text",
    opengram: "Choices, forms, inputs",
  },
  {
    label: "Control",
    discord: "Third-party platform",
    opengram: "Self-hosted, your data",
  },
  {
    label: "Notifications",
    discord: "No agent-specific push",
    opengram: "Push + iOS PWA",
  },
  {
    label: "Media",
    discord: "Ad-hoc uploads",
    opengram: "First-class w/ thumbnails",
  },
];

export function ProblemSection() {
  return (
    <section className="py-24 md:py-32 px-4">
      <div className="max-w-4xl mx-auto">
        <SectionReveal>
          <p className="font-mono text-xs text-tertiary uppercase tracking-widest mb-4">
            $ diff discord opengram
          </p>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
            Discord wasn&apos;t built for this.
          </h2>
          <p className="text-secondary text-base md:text-lg leading-relaxed max-w-3xl mb-12">
            Discord and Telegram work. They just weren&apos;t built for talking
            to agents.
          </p>
        </SectionReveal>

        <SectionReveal>
          {/* Comparison table */}
          <div className="glass rounded-xl overflow-hidden">
            <div className="grid grid-cols-[100px_1fr_1fr] md:grid-cols-[140px_1fr_1fr] border-b border-line/50">
              <div className="px-3 md:px-4 py-3 text-xs font-mono text-tertiary uppercase tracking-wider" />
              <div className="px-3 md:px-4 py-3 text-xs font-mono text-tertiary uppercase tracking-wider border-l border-line/50">
                Discord / Telegram
              </div>
              <div className="px-3 md:px-4 py-3 text-xs font-mono text-accent uppercase tracking-wider border-l border-line/50 bg-accent/[0.04]">
                OpenGram
              </div>
            </div>
            {rows.map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-[100px_1fr_1fr] md:grid-cols-[140px_1fr_1fr] ${
                  i < rows.length - 1 ? "border-b border-line/30" : ""
                }`}
              >
                <div className="px-3 md:px-4 py-3 text-xs font-mono text-tertiary">
                  {row.label}
                </div>
                <div className="px-3 md:px-4 py-3 text-sm text-tertiary leading-snug border-l border-line/50">
                  {row.discord}
                </div>
                <div className="px-3 md:px-4 py-3 text-sm text-primary leading-snug border-l border-line/50 bg-accent/[0.04] flex items-start gap-1.5">
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
