"use client";

import { useRef, useEffect, useState } from "react";
import { Github } from "lucide-react";

export function Footer() {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [showCheck, setShowCheck] = useState(false);

  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          setTimeout(() => setShowCheck(true), reducedMotion ? 0 : 600);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <footer className="py-16 md:py-24 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Agent message closer */}
        <div
          ref={bubbleRef}
          className={`mb-16 max-w-md transition-all duration-500 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
          }`}
        >
          <div className="flex items-end gap-2.5">
            {/* Avatar */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold"
              style={{
                background: "rgba(124, 91, 250, 0.15)",
                color: "#7c5bfa",
              }}
            >
              OG
            </div>

            {/* Bubble */}
            <div className="bg-elevated rounded-2xl rounded-bl-md border border-line/70 px-3 py-2">
              <p className="text-sm leading-relaxed">
                That&apos;s OpenGram. Questions or issues &rarr;{" "}
                <a
                  href="https://github.com/opengramsh/opengram"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  GitHub
                </a>
                .
              </p>
            </div>
          </div>

          {/* Timestamp + checkmark */}
          <div className="flex items-center gap-1.5 ml-10 mt-1.5">
            <span className="text-[10px] text-tertiary">just now</span>
            {showCheck && (
              <svg
                width="14"
                height="10"
                viewBox="0 0 14 10"
                fill="none"
                className="text-success"
                style={{ animation: "fade-in-check 0.3s ease-out" }}
              >
                <path
                  d="M1 5l3 3 6-7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4 5l3 3 6-7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.5"
                />
              </svg>
            )}
          </div>
        </div>

        {/* Footer links */}
        <div className="border-t border-line/30 pt-8">
          {/* Row 1 */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
            {/* Logo + wordmark */}
            <div className="flex items-center gap-2">
              <img src="/opengram-logo-sm.webp" alt="OpenGram" className="w-6 h-6 rounded-md" />
              <span className="font-mono font-semibold text-secondary text-sm">
                opengram
              </span>
            </div>

            {/* Links */}
            <div className="flex items-center gap-4 text-sm text-secondary">
              <a
                href="https://github.com/opengramsh/opengram"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors inline-flex items-center gap-1"
              >
                <Github size={14} /> GitHub
              </a>
              <a
                href="https://docs.opengram.sh"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors"
              >
                Docs
              </a>
              <span className="text-tertiary">MIT License</span>
              <a
                href="https://x.com/CodingBrice"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors"
              >
                X @CodingBrice
              </a>
            </div>
          </div>

          {/* Row 2 */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-tertiary">
            <span>Open source. Self-hosted. No tracking.</span>
            <span>Made by @CodingBrice</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
