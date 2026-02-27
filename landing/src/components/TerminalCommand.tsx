"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

const COMMAND = "curl -fsSL https://opengram.sh/install | sh";

export function TerminalCommand({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  };

  return (
    <div
      className={`glass rounded-xl overflow-hidden max-w-xl w-full group hover:shadow-[0_0_24px_rgba(124,91,250,0.15)] transition-shadow duration-300 ${className}`}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line/50">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="font-mono text-xs text-tertiary">bash</span>
        <div className="w-[52px]" />
      </div>

      {/* Command area */}
      <div className="flex items-center justify-between gap-3 px-4 py-4 bg-code">
        <code className="font-mono text-sm md:text-base flex items-center gap-2 min-w-0">
          <span className="text-tertiary select-none shrink-0">$</span>
          <span
            className={`truncate transition-colors duration-300 ${
              copied ? "text-success" : "text-primary"
            }`}
          >
            {COMMAND}
          </span>
          <span className="animate-blink text-accent select-none">▋</span>
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-all duration-200 cursor-pointer hover:bg-elevated text-secondary hover:text-primary"
          aria-label="Copy install command"
        >
          {copied ? (
            <>
              <Check size={14} className="text-success" />
              <span className="text-success">Copied</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span className="hidden sm:inline">Copy</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
