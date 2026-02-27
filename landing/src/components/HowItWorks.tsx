"use client";

import { useRef, useEffect, useState } from "react";
import { SectionReveal } from "./SectionReveal";

const CURVE_PATH = "M 90 70 C 150 40, 200 100, 300 70 C 400 40, 450 100, 510 70";

export function HowItWorks() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="py-24 md:py-32 px-4" ref={sectionRef}>
      <div className="max-w-4xl mx-auto">
        <SectionReveal>
          <p className="font-mono text-xs text-accent uppercase tracking-widest mb-12 text-center">
            How it works
          </p>

          {/* SVG animation */}
          <div className="flex justify-center mb-16">
            <svg
              viewBox="0 0 600 150"
              className="w-full max-w-xl"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Connection path — bezier curve */}
              <path
                d={CURVE_PATH}
                stroke="#1e2235"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />

              {/* Animated glowing path */}
              <path
                d={CURVE_PATH}
                stroke="#7c5bfa"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
                strokeDasharray="840"
                strokeDashoffset={isVisible ? "0" : "840"}
                style={{
                  transition: "stroke-dashoffset 3s ease-in-out",
                  filter: "drop-shadow(0 0 6px rgba(124, 91, 250, 0.5))",
                }}
              />

              {/* Traveling dot */}
              {isVisible && (
                <circle r="4" fill="#7c5bfa" filter="url(#glow)">
                  <animateMotion
                    dur="3s"
                    repeatCount="indefinite"
                    path={CURVE_PATH}
                  />
                </circle>
              )}

              {/* Node 1: Backend */}
              <g>
                <rect
                  x="30"
                  y="40"
                  width="60"
                  height="60"
                  rx="12"
                  fill="#0d0f1a"
                  stroke="#1e2235"
                  strokeWidth="1.5"
                  className={isVisible ? "hiw-node-pulse-1" : ""}
                />
                <text
                  x="60"
                  y="67"
                  textAnchor="middle"
                  fill="#6b7394"
                  fontSize="18"
                  fontFamily="monospace"
                >
                  {"{ }"}
                </text>
                <text
                  x="60"
                  y="85"
                  textAnchor="middle"
                  fill="#3d4466"
                  fontSize="8"
                >
                  Backend
                </text>
                <text
                  x="60"
                  y="125"
                  textAnchor="middle"
                  fill="#3d4466"
                  fontSize="10"
                >
                  Your Backend
                </text>
              </g>

              {/* Node 2: API Server */}
              <g>
                <rect
                  x="270"
                  y="40"
                  width="60"
                  height="60"
                  rx="12"
                  fill="#0d0f1a"
                  stroke="#7c5bfa"
                  strokeWidth="1.5"
                  strokeOpacity="0.3"
                  className={isVisible ? "hiw-node-pulse-2" : ""}
                />
                <text
                  x="300"
                  y="67"
                  textAnchor="middle"
                  fill="#7c5bfa"
                  fontSize="16"
                >
                  &#9670;
                </text>
                <text
                  x="300"
                  y="85"
                  textAnchor="middle"
                  fill="#3d4466"
                  fontSize="8"
                >
                  API
                </text>
                <text
                  x="300"
                  y="125"
                  textAnchor="middle"
                  fill="#3d4466"
                  fontSize="10"
                >
                  OpenGram API
                </text>
              </g>

              {/* Node 3: Phone */}
              <g>
                <rect
                  x="480"
                  y="40"
                  width="60"
                  height="60"
                  rx="12"
                  fill="#0d0f1a"
                  stroke="#1e2235"
                  strokeWidth="1.5"
                  className={isVisible ? "hiw-node-pulse-3" : ""}
                />
                <text
                  x="510"
                  y="75"
                  textAnchor="middle"
                  fill="#6b7394"
                  fontSize="22"
                >
                  &#128241;
                </text>
                <text
                  x="510"
                  y="125"
                  textAnchor="middle"
                  fill="#3d4466"
                  fontSize="10"
                >
                  Your Phone
                </text>
              </g>

              {/* Arrow heads — positioned along the curve */}
              <polygon points="190,60 200,65 190,70" fill="#1e2235" />
              <polygon points="430,60 440,65 430,70" fill="#1e2235" />

              {/* Chat bubble at phone (bigger, appears when visible) */}
              {isVisible && (
                <g opacity="0" style={{ animation: "fade-in-check 0.5s 2.5s forwards" }}>
                  <rect
                    x="515"
                    y="14"
                    width="48"
                    height="28"
                    rx="8"
                    fill="#7c5bfa"
                    fillOpacity="0.2"
                  />
                  <rect
                    x="521"
                    y="22"
                    width="18"
                    height="3"
                    rx="1.5"
                    fill="#7c5bfa"
                    fillOpacity="0.5"
                  />
                  <rect
                    x="521"
                    y="29"
                    width="30"
                    height="3"
                    rx="1.5"
                    fill="#7c5bfa"
                    fillOpacity="0.3"
                  />
                </g>
              )}

              {/* Glow filter */}
              <defs>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
            </svg>
          </div>
        </SectionReveal>

        <SectionReveal>
          <p className="text-secondary text-base md:text-lg leading-relaxed max-w-3xl mx-auto text-center mb-8">
            OpenGram is a Next.js app with an embedded SQLite database.
            There&apos;s no separate database service to manage — just one
            systemd process. Your agents talk to it over a REST API. Your phone
            talks to it as a PWA. It&apos;s designed to sit behind Tailscale so
            you never expose it to the public internet.
          </p>
        </SectionReveal>

        <SectionReveal>
          {/* Code snippet */}
          <div className="glass rounded-xl overflow-hidden max-w-2xl mx-auto">
            <div className="px-4 py-2 border-b border-line/30 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success/60" />
              <span className="font-mono text-xs text-tertiary">
                Send a message to any chat
              </span>
            </div>
            <pre className="px-4 py-4 text-sm font-mono overflow-x-auto text-secondary leading-relaxed">
              <code>{`curl -X POST https://your-opengram/api/v1/chats/abc123/messages \\
  -H "Content-Type: application/json" \\
  -d '{"role": "agent", "content": "Task completed."}'`}</code>
            </pre>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
