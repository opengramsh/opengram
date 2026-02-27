function Bubble({
  align = "left",
  width = "w-48",
}: {
  align?: "left" | "right";
  width?: string;
}) {
  return (
    <div
      className={`${width} h-8 rounded-2xl ${
        align === "left" ? "rounded-bl-sm" : "rounded-br-sm self-end"
      } ${align === "left" ? "bg-white/10" : "bg-accent/10"}`}
    />
  );
}

function LongBubble({ align = "left" }: { align?: "left" | "right" }) {
  return (
    <div className={`flex flex-col gap-1 ${align === "right" ? "items-end" : ""}`}>
      <div
        className={`w-52 h-7 rounded-2xl ${
          align === "left" ? "rounded-bl-none" : "rounded-br-none"
        } ${align === "left" ? "bg-white/10" : "bg-accent/10"}`}
      />
      <div
        className={`w-36 h-7 rounded-2xl ${
          align === "left" ? "bg-white/10" : "bg-accent/10"
        }`}
      />
    </div>
  );
}

function RequestOutline() {
  return (
    <div className="w-56 h-20 rounded-xl border border-white/15 flex flex-col items-center justify-center gap-2 p-3">
      <div className="w-32 h-3 rounded bg-white/10" />
      <div className="flex gap-2">
        <div className="w-16 h-6 rounded-md bg-white/10" />
        <div className="w-16 h-6 rounded-md bg-white/10" />
      </div>
    </div>
  );
}

function Column({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {children}
      {/* Duplicate for seamless loop */}
      {children}
    </div>
  );
}

export function GhostConversations() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-[0.08]">
      {/* Dot grid */}
      <div className="absolute inset-0 dot-grid opacity-40" />

      {/* Columns — 3 on desktop, 2 on mobile */}
      <div className="absolute inset-0 flex gap-6 px-4 md:px-8" style={{ filter: "blur(2px)" }}>
        {/* Column 1 */}
        <Column className="ghost-col-1 w-1/2 md:w-1/3 pt-8">
          <Bubble width="w-40" />
          <Bubble align="right" width="w-32" />
          <LongBubble />
          <Bubble align="right" width="w-44" />
          <RequestOutline />
          <Bubble width="w-36" />
          <Bubble align="right" width="w-28" />
          <LongBubble align="right" />
          <Bubble width="w-48" />
          <Bubble width="w-32" />
          <Bubble align="right" width="w-40" />
          <RequestOutline />
        </Column>

        {/* Column 2 */}
        <Column className="ghost-col-2 w-1/2 md:w-1/3 pt-20">
          <Bubble align="right" width="w-36" />
          <LongBubble />
          <Bubble width="w-44" />
          <Bubble align="right" width="w-28" />
          <Bubble width="w-40" />
          <RequestOutline />
          <Bubble align="right" width="w-48" />
          <LongBubble align="right" />
          <Bubble width="w-32" />
          <Bubble align="right" width="w-36" />
          <Bubble width="w-44" />
          <Bubble width="w-28" />
        </Column>

        {/* Column 3 */}
        <Column className="ghost-col-3 hidden md:flex w-1/3 pt-12">
          <LongBubble align="right" />
          <Bubble width="w-36" />
          <Bubble align="right" width="w-44" />
          <Bubble width="w-28" />
          <RequestOutline />
          <LongBubble />
          <Bubble align="right" width="w-40" />
          <Bubble width="w-48" />
          <Bubble align="right" width="w-32" />
          <RequestOutline />
          <Bubble width="w-36" />
          <LongBubble align="right" />
        </Column>
      </div>
    </div>
  );
}
