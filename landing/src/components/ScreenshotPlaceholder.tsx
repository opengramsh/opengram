import { SectionReveal } from "./SectionReveal";

export function ScreenshotPlaceholder() {
  return (
    <section className="py-16 md:py-24 px-4">
      <div className="max-w-4xl mx-auto flex flex-col items-center">
        <SectionReveal className="w-full flex flex-col items-center">
          {/* iPhone frame */}
          <div className="relative w-[280px] md:w-[320px]">
            {/* Phone frame */}
            <div className="rounded-[40px] border-[3px] border-line/60 bg-surface p-2 shadow-2xl">
              {/* Notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-page rounded-b-2xl z-10" />

              {/* Screen */}
              <div className="rounded-[32px] overflow-hidden bg-page aspect-[9/19.5] relative">
                {/* Gradient placeholder simulating the app UI */}
                <div className="absolute inset-0 flex flex-col">
                  {/* Status bar area */}
                  <div className="h-12 px-6 flex items-end justify-between">
                    <div className="w-16 h-2.5 rounded bg-white/10" />
                    <div className="flex gap-1.5">
                      <div className="w-4 h-2.5 rounded bg-white/10" />
                      <div className="w-4 h-2.5 rounded bg-white/10" />
                    </div>
                  </div>

                  {/* Header */}
                  <div className="px-5 py-3 flex items-center gap-3 border-b border-line/30">
                    <div className="w-5 h-5 rounded bg-white/10" />
                    <div className="w-20 h-3 rounded bg-white/10" />
                  </div>

                  {/* Chat list items */}
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`px-5 py-3.5 flex items-center gap-3 ${
                        i === 0 ? "bg-accent/[0.06]" : ""
                      } ${i < 4 ? "border-b border-line/20" : ""}`}
                    >
                      <div
                        className="w-9 h-9 rounded-full shrink-0"
                        style={{
                          background: [
                            "#7c5bfa",
                            "#f59e0b",
                            "#34d399",
                            "#ef4444",
                            "#3b82f6",
                          ][i],
                          opacity: 0.25,
                        }}
                      />
                      <div className="flex-1 space-y-1.5">
                        <div className="w-24 h-2.5 rounded bg-white/10" />
                        <div className="w-40 h-2 rounded bg-white/[0.06]" />
                      </div>
                      {i < 2 && (
                        <div className="w-4 h-4 rounded-full bg-accent/30" />
                      )}
                    </div>
                  ))}

                  {/* Fill remaining space with gradient */}
                  <div className="flex-1 bg-gradient-to-b from-transparent to-page/50" />
                </div>
              </div>
            </div>

            {/* Reflection / glow */}
            <div className="absolute -inset-8 bg-accent/[0.04] rounded-full blur-3xl -z-10" />
          </div>

          {/* Caption */}
          <p className="mt-8 text-tertiary text-sm text-center">
            Installed as a PWA on iOS — works like a native app.
          </p>
        </SectionReveal>
      </div>
    </section>
  );
}
