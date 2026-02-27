"use client";

import {
  MessageSquare,
  ListChecks,
  Radio,
  Smartphone,
  Terminal,
  Database,
} from "lucide-react";
import { SectionReveal } from "./SectionReveal";

/* ─── Card wrapper with glass + CSS group-hover ─── */
function FeatureCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="glass rounded-xl p-6 relative overflow-hidden group hover:border-accent/20 transition-all duration-300">
      <div className="relative z-10">
        <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center mb-4 text-accent">
          {icon}
        </div>
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-secondary text-sm leading-relaxed">{description}</p>
      </div>
      {/* Per-card hover animation layer — always mounted, CSS-driven visibility */}
      {children && (
        <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Parallel Chats: two bubbles drift apart ─── */
function ParallelChatsAnim() {
  return (
    <>
      <div
        className="absolute top-6 right-6 w-20 h-6 rounded-full border border-accent/30 feature-anim-drift-1"
      />
      <div
        className="absolute top-14 right-8 w-16 h-6 rounded-full border border-accent/20 feature-anim-drift-2"
      />
    </>
  );
}

/* ─── Structured Requests: button materializes + ripple ─── */
function StructuredRequestsAnim() {
  return (
    <div className="absolute bottom-4 right-4 flex items-center gap-1.5">
      <div
        className="px-3 py-1 rounded-md bg-accent/20 text-accent text-[10px] font-medium opacity-0"
        style={{ animation: "install-bounce 400ms 200ms ease-out forwards" }}
      >
        Approve
      </div>
      <div
        className="absolute inset-0 rounded-md bg-accent/10"
        style={{ animation: "ripple 800ms 500ms ease-out forwards" }}
      />
    </div>
  );
}

/* ─── Streaming: text types and loops ─── */
function StreamingAnim() {
  return (
    <div className="absolute bottom-4 right-4 font-mono text-[10px] text-accent/60">
      <span className="feature-anim-streaming">Real-time streaming...</span>
      <span className="animate-blink">&#9611;</span>
    </div>
  );
}

/* ─── Mobile PWA: phone scales up with bounce ─── */
function MobilePwaAnim() {
  return (
    <div
      className="absolute top-4 right-4 opacity-0"
      style={{ animation: "install-bounce 500ms ease-out forwards" }}
    >
      <div className="w-8 h-14 rounded-lg border-2 border-accent/30 relative">
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full bg-accent/30" />
      </div>
    </div>
  );
}

/* ─── Runtime-agnostic: curl snippet (CSS-only, always visible on hover) ─── */
function RuntimeAnim() {
  return (
    <div className="absolute bottom-3 right-3 font-mono text-[9px] text-accent/40">
      curl -X POST /api/v1/...
    </div>
  );
}

/* ─── Self-hosted: database icon pulses with green dot ─── */
function SelfHostedAnim() {
  return (
    <div className="absolute top-4 right-4 flex items-start gap-1.5">
      <Database size={16} className="text-accent/40" />
      <div
        className="w-2 h-2 rounded-full bg-success"
        style={{ animation: "pulse-health 2s ease-in-out infinite" }}
      />
    </div>
  );
}

/* ─── Feature grid ─── */
export function Features() {
  return (
    <section className="py-24 md:py-32 px-4">
      <div className="max-w-4xl mx-auto">
        <SectionReveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon={<MessageSquare size={20} />}
              title="Parallel chats per agent"
              description="One agent, multiple separate conversations. No context bleed between your debug session and your production incident."
            >
              <ParallelChatsAnim />
            </FeatureCard>

            <FeatureCard
              icon={<ListChecks size={20} />}
              title="Structured requests"
              description="Agents send choice buttons, forms, and text inputs — not plain text pretending to be UI."
            >
              <StructuredRequestsAnim />
            </FeatureCard>

            <FeatureCard
              icon={<Radio size={20} />}
              title="Streaming responses"
              description="Real-time token streaming from agent to your phone, with live typing indicators."
            >
              <StreamingAnim />
            </FeatureCard>

            <FeatureCard
              icon={<Smartphone size={20} />}
              title="Mobile-first PWA"
              description="Installs on iOS home screen. Feels native. No App Store, no update approval cycle."
            >
              <MobilePwaAnim />
            </FeatureCard>

            <FeatureCard
              icon={<Terminal size={20} />}
              title="Runtime-agnostic API"
              description="Works with OpenClaw, custom orchestrators, or any backend that can make an HTTP request."
            >
              <RuntimeAnim />
            </FeatureCard>

            <FeatureCard
              icon={<Database size={20} />}
              title="Self-hosted"
              description="SQLite + a single systemd service. Runs on a VPS, Raspberry Pi, or your laptop."
            >
              <SelfHostedAnim />
            </FeatureCard>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
}
