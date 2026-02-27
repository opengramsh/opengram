import { Play } from "lucide-react";
import { SectionReveal } from "./SectionReveal";

export function VideoPlaceholder() {
  return (
    <section className="py-16 md:py-24 px-4">
      <div className="max-w-3xl mx-auto">
        <SectionReveal>
          <div className="glass rounded-2xl aspect-video flex flex-col items-center justify-center gap-4">
            <div className="w-14 h-14 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Play size={24} className="text-accent ml-1" />
            </div>
            <p className="text-secondary text-sm">
              Full walkthrough — coming soon
            </p>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
