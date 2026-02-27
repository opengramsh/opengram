"use client";

import { useState, useEffect } from "react";
import { ChevronDown, Star } from "lucide-react";
import { TerminalCommand } from "./TerminalCommand";

const HEADLINE = "A purpose-built chat UI for your AI agents.";

/* ─── Realistic app preview mockups ─── */
function PhoneMockup() {
  return (
    <div className="relative w-[260px] sm:w-[280px] shrink-0">
      {/* Phone frame */}
      <div className="rounded-[2rem] border-2 border-line/40 bg-surface overflow-hidden shadow-2xl shadow-black/40">
        {/* Notch */}
        <div className="flex justify-center pt-2 pb-1 bg-surface">
          <div className="w-20 h-5 rounded-full bg-page" />
        </div>
        {/* Status bar */}
        <div className="flex items-center justify-between px-5 py-1 text-[10px] text-tertiary">
          <span>9:41</span>
          <div className="flex items-center gap-1">
            <div className="w-4 h-2 rounded-sm border border-tertiary/50">
              <div className="w-2.5 h-1 rounded-sm bg-success m-px" />
            </div>
          </div>
        </div>
        {/* App header */}
        <div className="px-4 py-2.5 border-b border-line/30 flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[8px] font-bold text-accent">DB</div>
          <span className="text-xs font-medium text-primary">Deploy Bot</span>
        </div>
        {/* Chat messages */}
        <div className="px-3 py-3 space-y-2 bg-page min-h-[220px]">
          <div className="flex items-end gap-1.5">
            <div className="w-5 h-5 rounded-full bg-accent/20 shrink-0 flex items-center justify-center text-[7px] font-bold text-accent">DB</div>
            <div className="bg-elevated rounded-xl rounded-bl-md border border-line/50 px-2.5 py-1.5 max-w-[80%]">
              <p className="text-[10px] leading-relaxed text-primary">Deployment to production completed. v2.1.4 is now live.</p>
            </div>
          </div>
          <div className="flex items-end gap-1.5">
            <div className="w-5 h-5 shrink-0" />
            <div className="bg-elevated rounded-xl rounded-bl-md border border-line/50 px-2.5 py-1.5 max-w-[80%]">
              <p className="text-[10px] leading-relaxed text-primary">Health checks passing on all 3 instances.</p>
            </div>
          </div>
          <div className="flex items-end gap-1.5 justify-end">
            <div className="bg-accent/20 rounded-xl rounded-br-md px-2.5 py-1.5 max-w-[80%]">
              <p className="text-[10px] leading-relaxed text-primary">What about error rates?</p>
            </div>
          </div>
          <div className="flex items-end gap-1.5">
            <div className="w-5 h-5 rounded-full bg-accent/20 shrink-0 flex items-center justify-center text-[7px] font-bold text-accent">DB</div>
            <div className="bg-elevated rounded-xl rounded-bl-md border border-line/50 px-2.5 py-1.5 max-w-[80%]">
              <p className="text-[10px] leading-relaxed text-primary">Error rate at 0.02% — well within threshold. No anomalies detected.</p>
            </div>
          </div>
          {/* Request card */}
          <div className="ml-6 rounded-lg border border-accent/20 bg-elevated/80 p-2">
            <p className="text-[9px] font-medium text-primary mb-1.5">Rollback to previous version?</p>
            <div className="flex gap-1.5">
              <div className="px-2 py-0.5 rounded bg-accent/10 text-accent text-[8px] font-medium border border-accent/20">Yes, rollback</div>
              <div className="px-2 py-0.5 rounded bg-surface text-secondary text-[8px] font-medium border border-line/30">No, keep it</div>
            </div>
          </div>
        </div>
        {/* Input bar */}
        <div className="px-3 py-2 border-t border-line/30 bg-surface">
          <div className="flex items-center gap-2 bg-page rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-tertiary flex-1">Type a message...</span>
            <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#7c5bfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </div>
          </div>
        </div>
        {/* Home indicator */}
        <div className="flex justify-center py-2 bg-surface">
          <div className="w-24 h-1 rounded-full bg-line" />
        </div>
      </div>
    </div>
  );
}

function DesktopMockup() {
  return (
    <div className="hidden lg:block relative w-[480px] shrink-0">
      {/* Browser frame */}
      <div className="rounded-xl border border-line/40 bg-surface overflow-hidden shadow-2xl shadow-black/40">
        {/* Title bar */}
        <div className="flex items-center gap-3 px-3 py-2 border-b border-line/30 bg-surface">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="bg-page rounded-md px-3 py-0.5 text-[10px] text-tertiary font-mono flex items-center gap-1.5">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              opengram.tail1234.ts.net
            </div>
          </div>
        </div>
        {/* App content — split view */}
        <div className="flex bg-page" style={{ height: 280 }}>
          {/* Sidebar */}
          <div className="w-[180px] border-r border-line/30 flex flex-col bg-surface/50">
            <div className="px-3 py-2 border-b border-line/20">
              <span className="text-[10px] font-semibold text-primary">Chats</span>
            </div>
            {[
              { name: "Deploy Bot", initials: "DB", color: "#7c5bfa", msg: "Health checks passing...", active: true },
              { name: "Code Review", initials: "CR", color: "#f59e0b", msg: "2 comments left on PR", badge: 1 },
              { name: "Daily Standup", initials: "DS", color: "#34d399", msg: "Good morning!", badge: 2 },
            ].map((chat) => (
              <div key={chat.name} className={`flex items-center gap-2 px-3 py-2 ${chat.active ? "bg-accent/[0.06]" : ""} border-b border-line/10`}>
                <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[7px] font-bold" style={{ background: `${chat.color}22`, color: chat.color }}>{chat.initials}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-medium text-primary truncate">{chat.name}</span>
                    {chat.badge && <span className="w-3.5 h-3.5 rounded-full bg-accent text-white text-[7px] flex items-center justify-center font-bold shrink-0">{chat.badge}</span>}
                  </div>
                  <p className="text-[8px] text-secondary truncate">{chat.msg}</p>
                </div>
              </div>
            ))}
          </div>
          {/* Chat view */}
          <div className="flex-1 flex flex-col">
            <div className="px-3 py-2 border-b border-line/20 flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[7px] font-bold text-accent">DB</div>
              <span className="text-[10px] font-medium text-primary">Deploy Bot</span>
            </div>
            <div className="flex-1 px-3 py-2 space-y-1.5 overflow-hidden">
              <div className="flex items-end gap-1.5">
                <div className="w-4 h-4 rounded-full bg-accent/20 shrink-0 flex items-center justify-center text-[6px] font-bold text-accent">DB</div>
                <div className="bg-elevated rounded-lg rounded-bl-sm border border-line/50 px-2 py-1 max-w-[75%]">
                  <p className="text-[9px] leading-relaxed text-primary">Deployment to production completed. v2.1.4 is now live across all 3 instances.</p>
                </div>
              </div>
              <div className="flex items-end gap-1.5">
                <div className="w-4 h-4 shrink-0" />
                <div className="bg-elevated rounded-lg rounded-bl-sm border border-line/50 px-2 py-1 max-w-[75%]">
                  <p className="text-[9px] leading-relaxed text-primary">Health checks passing. Response times nominal.</p>
                </div>
              </div>
              <div className="flex items-end gap-1.5 justify-end">
                <div className="bg-accent/20 rounded-lg rounded-br-sm px-2 py-1 max-w-[75%]">
                  <p className="text-[9px] leading-relaxed text-primary">What about error rates?</p>
                </div>
              </div>
              <div className="flex items-end gap-1.5">
                <div className="w-4 h-4 rounded-full bg-accent/20 shrink-0 flex items-center justify-center text-[6px] font-bold text-accent">DB</div>
                <div className="bg-elevated rounded-lg rounded-bl-sm border border-line/50 px-2 py-1 max-w-[75%]">
                  <p className="text-[9px] leading-relaxed text-primary">Error rate at 0.02% — well within threshold.</p>
                </div>
              </div>
              {/* Request card */}
              <div className="ml-5 rounded-md border border-accent/20 bg-elevated/80 p-1.5">
                <p className="text-[8px] font-medium text-primary mb-1">Rollback to previous version?</p>
                <div className="flex gap-1">
                  <div className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[7px] font-medium border border-accent/20">Yes, rollback</div>
                  <div className="px-1.5 py-0.5 rounded bg-surface text-secondary text-[7px] font-medium border border-line/30">No, keep it</div>
                </div>
              </div>
            </div>
            {/* Input */}
            <div className="px-3 py-1.5 border-t border-line/20">
              <div className="flex items-center gap-1.5 bg-surface rounded-md px-2 py-1">
                <span className="text-[9px] text-tertiary flex-1">Type a message...</span>
                <div className="w-4 h-4 rounded bg-accent/20 flex items-center justify-center">
                  <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="#7c5bfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  const [displayText, setDisplayText] = useState("");
  const [showCursor, setShowCursor] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (reducedMotion) {
      requestAnimationFrame(() => {
        setDisplayText(HEADLINE);
        setShowCursor(false);
        setLoaded(true);
      });
      return;
    }

    let i = 0;
    const interval = setInterval(() => {
      if (i < HEADLINE.length) {
        i++;
        setDisplayText(HEADLINE.slice(0, i));
      } else {
        clearInterval(interval);
        setTimeout(() => setShowCursor(false), 2000);
      }
    }, 55);

    setTimeout(() => setLoaded(true), HEADLINE.length * 55 * 0.3);

    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-[100dvh] flex flex-col items-center justify-center px-4 pt-20 pb-12 text-center">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Wordmark — bigger */}
        <div className="flex items-center justify-center gap-3.5 mb-2">
          <img src="/opengram-logo-sm.webp" alt="OpenGram" className="w-14 h-14 rounded-2xl" />
          <span className="font-mono font-bold text-primary text-3xl tracking-tight">
            opengram
          </span>
        </div>

        {/* Solo dev badge */}
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono text-secondary border border-line/40 bg-surface/50">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            built by one person &middot; open source
          </span>
        </div>

        {/* Self-typing headline */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-[72px] font-bold leading-[1.08] tracking-tight min-h-[2.4em]">
          {displayText}
          {showCursor && (
            <span className="animate-blink text-accent ml-0.5 font-light">
              |
            </span>
          )}
        </h1>

        {/* Subline */}
        <p
          className={`text-secondary text-base md:text-lg leading-relaxed max-w-2xl mx-auto transition-opacity duration-700 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        >
          Each agent gets a dedicated inbox — parallel chats, structured requests,
          streaming responses. A mobile-first PWA you self-host.
        </p>

        {/* Terminal */}
        <div
          className={`flex justify-center transition-opacity duration-700 delay-200 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        >
          <TerminalCommand />
        </div>

        {/* CTAs */}
        <div
          className={`flex flex-wrap items-center justify-center gap-4 transition-opacity duration-700 delay-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        >
          <a
            href="https://github.com/opengramsh/opengram"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-elevated border border-line hover:border-accent/30 text-primary text-sm font-medium transition-all hover:bg-surface"
          >
            <Star size={16} />
            Star on GitHub
          </a>
          <a
            href="https://docs.opengram.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-accent text-sm font-medium hover:text-primary transition-colors"
          >
            Read the docs
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>

        {/* MIT label */}
        <p
          className={`text-tertiary text-xs transition-opacity duration-700 delay-500 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        >
          MIT License &middot; Made by{" "}
          <a
            href="https://x.com/CodingBrice"
            target="_blank"
            rel="noopener noreferrer"
            className="text-secondary hover:text-accent transition-colors"
          >
            @CodingBrice
          </a>
        </p>
      </div>

      {/* App preview mockups */}
      <div
        className={`mt-12 flex items-center justify-center gap-8 transition-all duration-1000 delay-700 ${
          loaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
        }`}
      >
        <PhoneMockup />
        <DesktopMockup />
      </div>

      {/* Scroll chevron */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-tertiary animate-bounce-subtle">
        <ChevronDown size={20} />
      </div>
    </section>
  );
}
