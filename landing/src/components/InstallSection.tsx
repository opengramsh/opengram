import { SectionReveal } from "./SectionReveal";
import { TerminalCommand } from "./TerminalCommand";

export function InstallSection() {
  return (
    <section id="install" className="py-24 md:py-32 px-4 bg-surface border-t border-line/20">
      <div className="max-w-4xl mx-auto flex flex-col items-center text-center">
        <SectionReveal className="w-full flex flex-col items-center">
          <p className="font-mono text-xs text-accent uppercase tracking-widest mb-6">
            Get started
          </p>

          <TerminalCommand className="mb-6" />

          <p className="text-tertiary text-sm mb-4">
            Node 20+ &middot; Linux or macOS &middot; Runs as a systemd service
            <br />
            Designed for Tailscale — no public internet required
          </p>

          <a
            href="https://docs.opengram.sh/quick-start"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent text-sm hover:text-primary transition-colors"
          >
            &rarr; Full installation guide
          </a>
        </SectionReveal>
      </div>
    </section>
  );
}
