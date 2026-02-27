"use client";

import { useEffect, useState } from "react";
import { Github } from "lucide-react";

const GITHUB_REPO = "opengramsh/opengram";

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function Nav() {
  const [stars, setStars] = useState<number | null>(null);
  const [displayStars, setDisplayStars] = useState(0);

  useEffect(() => {
    const cached = sessionStorage.getItem("gh-stars");
    if (cached) {
      const n = parseInt(cached, 10);
      requestAnimationFrame(() => setStars(n));
      return;
    }

    fetch(`https://api.github.com/repos/${GITHUB_REPO}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.stargazers_count != null) {
          const count = data.stargazers_count;
          sessionStorage.setItem("gh-stars", String(count));
          setStars(count);
        }
      })
      .catch(() => {});
  }, []);

  // Count-up animation
  useEffect(() => {
    if (stars === null || stars === 0) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const duration = 800;
    const start = performance.now();
    const target = stars;

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      setDisplayStars(
        reducedMotion ? target : Math.round(easeOut(progress) * target)
      );
      if (!reducedMotion && progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }, [stars]);

  return (
    <nav className="sticky top-0 z-50 glass border-b border-line/30">
      <div className="max-w-6xl mx-auto px-4 h-[52px] flex items-center justify-between">
        {/* Left: Logo + wordmark */}
        <a href="/" className="flex items-center gap-2.5">
          <img src="/opengram-logo-sm.webp" alt="OpenGram" className="w-7 h-7 rounded-lg" />
          <span className="font-mono font-semibold text-primary text-sm tracking-tight">
            opengram
          </span>
        </a>

        {/* Right: Links */}
        <div className="flex items-center gap-3">
          {/* GitHub */}
          <a
            href={`https://github.com/${GITHUB_REPO}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-secondary hover:text-primary transition-colors text-sm"
          >
            <Github size={16} />
            {stars !== null && (
              <span className="font-mono text-xs tabular-nums">
                <span className="text-amber-400">★</span>{" "}
                {displayStars.toLocaleString()}
              </span>
            )}
          </a>

          {/* Install pill */}
          <a
            href="#install"
            className="hidden sm:inline-flex px-3 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
          >
            Install
          </a>

          {/* Docs */}
          <a
            href="https://docs.opengram.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="text-secondary hover:text-primary transition-colors text-sm"
          >
            Docs
          </a>
        </div>
      </div>
    </nav>
  );
}
