"use client";

import { useState, useEffect } from "react";
import { Github, ChevronDown } from "lucide-react";
import { TerminalCommand } from "./TerminalCommand";

const HEADLINE = "A purpose-built chat UI for your AI agents.";

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

    // Fade in content after headline starts
    setTimeout(() => setLoaded(true), HEADLINE.length * 55 * 0.3);

    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-[100dvh] flex flex-col items-center justify-center px-4 text-center">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Wordmark */}
        <div className="flex items-center justify-center gap-2.5 mb-2">
          <img src="/opengram-logo-sm.webp" alt="OpenGram" className="w-8 h-8 rounded-lg" />
          <span className="font-mono font-semibold text-secondary text-sm tracking-tight">
            opengram
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
          OpenGram gives each agent a dedicated inbox — parallel conversations,
          structured interactions, and a mobile-first PWA you self-host.
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
            <Github size={16} />
            GitHub
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

      {/* Scroll chevron */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-tertiary animate-bounce-subtle">
        <ChevronDown size={20} />
      </div>
    </section>
  );
}
