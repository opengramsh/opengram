"use client";

import { useEffect, useRef, useState } from "react";

const NODE_LABELS = ["Problem", "Preview", "Features", "Try it", "How", "Install"];

export function ThreadTimeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const totalHeight = el.offsetHeight;
      const scrolled = Math.max(0, -rect.top);
      setProgress(Math.min(1, scrolled / (totalHeight - window.innerHeight)));
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    requestAnimationFrame(handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const svgHeight = 1000;
  const totalLength = svgHeight;
  const dashOffset = totalLength * (1 - progress);

  // Node positions distributed along the line
  const nodePositions = NODE_LABELS.map((_, i) =>
    Math.round((svgHeight / (NODE_LABELS.length + 1)) * (i + 1))
  );

  return (
    <div
      ref={containerRef}
      className="absolute left-2 md:left-4 lg:left-6 top-0 bottom-0 w-24 hidden lg:block pointer-events-none z-20"
    >
      <div className="sticky top-0 h-screen">
        <svg
          className="w-full h-full"
          viewBox={`0 0 120 ${svgHeight}`}
          preserveAspectRatio="none"
          fill="none"
        >
          {/* Background line */}
          <line
            x1="24"
            y1="0"
            x2="24"
            y2={svgHeight}
            stroke="#1e2235"
            strokeWidth="1"
          />

          {/* Active glowing line */}
          <line
            x1="24"
            y1="0"
            x2="24"
            y2={svgHeight}
            stroke="#7c5bfa"
            strokeWidth="1.5"
            strokeDasharray={totalLength}
            strokeDashoffset={dashOffset}
            style={{
              filter: "drop-shadow(0 0 4px rgba(124, 91, 250, 0.4))",
              transition: "stroke-dashoffset 0.15s ease-out",
            }}
          />

          {/* Node markers + labels */}
          {nodePositions.map((y, i) => {
            const active = progress * svgHeight >= y;
            return (
              <g key={i}>
                {/* Outer circle */}
                <circle
                  cx="24"
                  cy={y}
                  r="6"
                  fill={active ? "#7c5bfa" : "#0d0f1a"}
                  stroke={active ? "#7c5bfa" : "#1e2235"}
                  strokeWidth="1.5"
                  style={{
                    transition: "fill 0.4s ease, stroke 0.4s ease",
                    filter: active
                      ? "drop-shadow(0 0 6px rgba(124, 91, 250, 0.5))"
                      : "none",
                  }}
                />
                {/* Inner dot */}
                <circle
                  cx="24"
                  cy={y}
                  r="2"
                  fill={active ? "#e8eaf0" : "#3d4466"}
                  style={{ transition: "fill 0.4s ease" }}
                />
                {/* Label */}
                <text
                  x="38"
                  y={y + 4}
                  fill={active ? "#6b7394" : "#3d4466"}
                  fontSize="10"
                  fontFamily="monospace"
                  style={{ transition: "fill 0.4s ease" }}
                >
                  {NODE_LABELS[i]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
