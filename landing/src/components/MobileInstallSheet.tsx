"use client";

import { useState, useEffect } from "react";
import { Copy, Check, X } from "lucide-react";

const COMMAND = "curl -fsSL https://opengram.sh/install | sh";

export function MobileInstallSheet() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Hide when demo section is in viewport
  useEffect(() => {
    const demo = document.getElementById("demo");
    if (!demo) return;

    const observer = new IntersectionObserver(
      ([entry]) => setHidden(entry.isIntersecting),
      { threshold: 0.1 }
    );

    observer.observe(demo);
    return () => observer.disconnect();
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  };

  if (hidden) return null;

  return (
    <>
      {/* Sticky bottom bar - mobile only */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 sm:hidden transition-transform duration-300 ${
          open ? "translate-y-full" : "translate-y-0"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <button
          onClick={() => setOpen(true)}
          className="w-full py-3 bg-surface/95 backdrop-blur-md border-t border-line/30 text-center cursor-pointer"
        >
          <span className="text-accent text-sm font-medium">
            Install OpenGram ↓
          </span>
        </button>
      </div>

      {/* Bottom sheet overlay */}
      {open && (
        <div className="fixed inset-0 z-[60] sm:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />

          {/* Sheet */}
          <div
            className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-2xl border-t border-line/30"
            style={{
              animation: "slide-up 0.3s ease-out",
              paddingBottom: "env(safe-area-inset-bottom, 16px)",
            }}
          >
            {/* Handle + close */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-line mx-auto" />
              <button
                onClick={() => setOpen(false)}
                className="absolute right-3 top-3 text-secondary hover:text-primary cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-4 pb-4 space-y-4">
              {/* Command */}
              <div className="bg-code rounded-xl px-4 py-3">
                <code className="font-mono text-sm text-primary break-all">
                  <span className="text-tertiary">$ </span>
                  {COMMAND}
                </code>
              </div>

              {/* Copy button */}
              <button
                onClick={handleCopy}
                className={`w-full py-3 rounded-xl font-medium text-sm transition-all cursor-pointer ${
                  copied
                    ? "bg-success/20 text-success"
                    : "bg-accent text-white hover:bg-accent/90"
                }`}
              >
                {copied ? (
                  <span className="inline-flex items-center gap-2">
                    <Check size={16} /> Copied to clipboard
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Copy size={16} /> Copy install command
                  </span>
                )}
              </button>

              {/* Requirements */}
              <p className="text-tertiary text-xs text-center">
                Node 20+ &middot; Linux or macOS
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
