"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, ArrowLeft } from "lucide-react";
import { SectionReveal } from "./SectionReveal";

/* ─── Types ─── */
interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: string;
  streaming?: boolean;
}

interface RequestCard {
  question: string;
  options: { label: string; value: string }[];
  resolved?: string;
}

interface AgentData {
  id: string;
  name: string;
  color: string;
  initials: string;
  initialMessages: Message[];
  responses: string[];
  preview: string;
  unread: number;
}

/* ─── Agent data ─── */
const agents: AgentData[] = [
  {
    id: "deploy",
    name: "Deploy Bot",
    color: "#7c5bfa",
    initials: "DB",
    preview: "Health checks passing. Response times nominal.",
    unread: 0,
    initialMessages: [
      {
        id: "d1",
        role: "agent",
        content:
          "Deployment to production completed. v2.1.4 is now live across all 3 instances.",
        timestamp: "2:34 PM",
      },
      {
        id: "d2",
        role: "agent",
        content: "Health checks passing. Response times nominal.",
        timestamp: "2:34 PM",
      },
    ],
    responses: [
      "Deployment pipeline triggered. Running health checks on 3 services... All systems green. v2.1.4 is live.",
      "Build queued. Estimated deploy time: ~4 minutes. I'll notify you when it's done.",
      "Detected a config drift on staging vs production. Want me to sync them before deploying?",
    ],
  },
  {
    id: "review",
    name: "Code Review Agent",
    color: "#f59e0b",
    initials: "CR",
    preview: "Initial review complete. 2 comments left on the PR.",
    unread: 1,
    initialMessages: [
      {
        id: "r1",
        role: "agent",
        content:
          'PR #142 opened by @sarah — "Refactor auth middleware". I\'ll take a look.',
        timestamp: "1:15 PM",
      },
      {
        id: "r2",
        role: "agent",
        content: "Initial review complete. 2 comments left on the PR.",
        timestamp: "1:22 PM",
      },
    ],
    responses: [
      "Reviewed. Found 2 issues worth addressing: unused import in auth.ts line 42, and the cache TTL looks too aggressive for this endpoint. Rest looks solid.",
      "LGTM overall. One suggestion: the error handler on line 88 swallows the original error context. Worth a quick fix before merge.",
      "3 files changed, 47 insertions, 12 deletions. No security concerns. Complexity looks fine. Ready to merge when you are.",
    ],
  },
  {
    id: "standup",
    name: "Daily Standup",
    color: "#34d399",
    initials: "DS",
    preview: "Good morning! Ready to capture today's standup.",
    unread: 2,
    initialMessages: [
      {
        id: "s1",
        role: "agent",
        content:
          "Good morning! Ready to capture today's standup. What did you work on yesterday?",
        timestamp: "9:00 AM",
      },
    ],
    responses: [
      "Got it. Logged to today's standup summary. Anything blocking you that needs attention before EOD?",
      "Noted. You're the third person to mention that API latency issue today — want me to escalate it to a tracked task?",
      "Summary recorded. Yesterday: 3 tasks closed. Today: 2 in progress. No blockers flagged so far.",
    ],
  },
];

/* ─── Avatar component ─── */
function Avatar({ color, initials, size = 36 }: { color: string; initials: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 font-semibold"
      style={{
        width: size,
        height: size,
        background: `${color}22`,
        color: color,
        fontSize: size * 0.36,
      }}
    >
      {initials}
    </div>
  );
}

/* ─── Typing indicator ─── */
function TypingIndicator({ color }: { color: string }) {
  return (
    <div className="flex items-end gap-2 px-4 py-2">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `${color}22` }}
      />
      <div className="bg-elevated rounded-2xl rounded-bl-md border border-line/70 px-3 py-2 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-secondary typing-dot-1" />
        <span className="w-1.5 h-1.5 rounded-full bg-secondary typing-dot-2" />
        <span className="w-1.5 h-1.5 rounded-full bg-secondary typing-dot-3" />
      </div>
    </div>
  );
}

/* ─── Request card widget ─── */
function RequestWidget({
  card,
  onAction,
}: {
  card: RequestCard;
  onAction: (value: string) => void;
}) {
  return (
    <div className="mx-4 mb-3">
      <div
        className={`rounded-xl border p-4 transition-all duration-300 ${
          card.resolved
            ? "border-line/30 bg-surface/50 opacity-70"
            : "border-accent/20 bg-elevated/80"
        }`}
      >
        <p className="text-sm font-medium mb-3">{card.question}</p>
        <div className="flex gap-2">
          {card.options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => !card.resolved && onAction(opt.value)}
              disabled={!!card.resolved}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                card.resolved === opt.value
                  ? "bg-accent text-white"
                  : card.resolved
                    ? "bg-surface text-tertiary"
                    : "bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20"
              }`}
            >
              {opt.label}
              {card.resolved === opt.value && " ✓"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Main demo component ─── */
export function InteractiveDemo() {
  const [activeChat, setActiveChat] = useState("deploy");
  const [chats, setChats] = useState<Record<string, Message[]>>(() => {
    const init: Record<string, Message[]> = {};
    agents.forEach((a) => {
      init[a.id] = [...a.initialMessages];
    });
    return init;
  });
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [requestCard, setRequestCard] = useState<RequestCard | null>(null);
  const [showList, setShowList] = useState(true);
  const [unread, setUnread] = useState<Record<string, number>>({
    deploy: 0,
    review: 1,
    standup: 2,
  });
  const [deployInteractions, setDeployInteractions] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeAgent = agents.find((a) => a.id === activeChat)!;

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, isTyping, activeChat]);

  // Focus input when switching chats
  useEffect(() => {
    if (!showList) inputRef.current?.focus();
  }, [showList, activeChat]);

  const streamResponse = useCallback(
    (agentId: string, text: string, onComplete?: () => void) => {
      setIsTyping(true);

      setTimeout(() => {
        setIsTyping(false);
        const msgId = `msg-${Date.now()}`;
        let charIndex = 0;

        setChats((prev) => ({
          ...prev,
          [agentId]: [
            ...prev[agentId],
            {
              id: msgId,
              role: "agent",
              content: "",
              timestamp: "just now",
              streaming: true,
            },
          ],
        }));

        const streamInterval = setInterval(() => {
          charIndex++;
          if (charIndex <= text.length) {
            setChats((prev) => ({
              ...prev,
              [agentId]: prev[agentId].map((m) =>
                m.id === msgId
                  ? { ...m, content: text.slice(0, charIndex) }
                  : m
              ),
            }));
          } else {
            clearInterval(streamInterval);
            setChats((prev) => ({
              ...prev,
              [agentId]: prev[agentId].map((m) =>
                m.id === msgId ? { ...m, streaming: false } : m
              ),
            }));
            onComplete?.();
          }
        }, 25);
      }, 1500 + Math.random() * 1000);
    },
    []
  );

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isTyping) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: "just now",
    };

    setChats((prev) => ({
      ...prev,
      [activeChat]: [...prev[activeChat], userMsg],
    }));
    setInput("");

    const response =
      activeAgent.responses[
        Math.floor(Math.random() * activeAgent.responses.length)
      ];

    streamResponse(activeChat, response, () => {
      if (activeChat === "deploy" && deployInteractions === 0) {
        setDeployInteractions(1);
        setTimeout(() => {
          setRequestCard({
            question: "Rollback to previous version?",
            options: [
              { label: "Yes, rollback", value: "yes" },
              { label: "No, keep it", value: "no" },
            ],
          });
        }, 400);
      }
    });
  };

  const handleRequestAction = (value: string) => {
    if (!requestCard) return;
    setRequestCard({ ...requestCard, resolved: value });

    const reply =
      value === "yes"
        ? "Rolling back to v2.1.3... Done. All instances are back on the previous version. Health checks passing."
        : "Understood. v2.1.4 stays live. I'll monitor error rates for the next 15 minutes and let you know if anything spikes.";

    setTimeout(() => streamResponse("deploy", reply), 600);
  };

  const selectChat = (id: string) => {
    setActiveChat(id);
    setUnread((prev) => ({ ...prev, [id]: 0 }));
    setShowList(false);
    // Reset request card if switching away from deploy
    if (id !== "deploy") setRequestCard(null);
  };

  /* ─── Chat list panel ─── */
  const chatList = (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-line/30">
        <h3 className="font-semibold text-sm">Chats</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {agents.map((agent) => {
          const msgs = chats[agent.id];
          const lastMsg = msgs[msgs.length - 1];
          const isActive = activeChat === agent.id;

          return (
            <button
              key={agent.id}
              onClick={() => selectChat(agent.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                isActive
                  ? "bg-accent/[0.06]"
                  : "hover:bg-elevated/50"
              } border-b border-line/20`}
            >
              <Avatar color={agent.color} initials={agent.initials} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate">
                    {agent.name}
                  </span>
                  <span className="text-[10px] text-tertiary ml-2 shrink-0">
                    {lastMsg?.timestamp}
                  </span>
                </div>
                <p className="text-xs text-secondary truncate mt-0.5">
                  {lastMsg?.content.slice(0, 50)}
                  {(lastMsg?.content.length ?? 0) > 50 ? "..." : ""}
                </p>
              </div>
              {(unread[agent.id] ?? 0) > 0 && (
                <span className="w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                  {unread[agent.id]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  /* ─── Chat view panel ─── */
  const chatView = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-line/30 flex items-center gap-3">
        <button
          onClick={() => setShowList(true)}
          className="md:hidden text-secondary hover:text-primary transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <Avatar
          color={activeAgent.color}
          initials={activeAgent.initials}
          size={28}
        />
        <span className="font-medium text-sm">{activeAgent.name}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-3 space-y-1">
        {chats[activeChat].map((msg) => (
          <div
            key={msg.id}
            className={`flex items-end gap-2 px-4 py-1 ${
              msg.role === "user" ? "justify-end" : ""
            }`}
          >
            {msg.role === "agent" && (
              <Avatar
                color={activeAgent.color}
                initials={activeAgent.initials}
                size={24}
              />
            )}
            <div
              className={`max-w-[80%] px-3 py-2 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-accent/20 text-primary rounded-2xl rounded-br-md"
                  : "bg-elevated rounded-2xl rounded-bl-md border border-line/70"
              }`}
            >
              {msg.content}
              {msg.streaming && (
                <span className="animate-blink text-accent ml-0.5">▋</span>
              )}
            </div>
          </div>
        ))}

        {/* Request card */}
        {activeChat === "deploy" && requestCard && (
          <RequestWidget card={requestCard} onAction={handleRequestAction} />
        )}

        {/* Typing indicator */}
        {isTyping && <TypingIndicator color={activeAgent.color} />}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-line/30">
        <div className="flex items-center gap-2 bg-surface rounded-xl px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type a message..."
            className="flex-1 bg-transparent text-sm text-primary placeholder:text-tertiary outline-none"
            disabled={isTyping}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="w-8 h-8 rounded-lg bg-accent/20 text-accent flex items-center justify-center hover:bg-accent/30 transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-default shrink-0"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <section id="demo" className="py-24 md:py-32 px-4 bg-demo-bg">
      <div className="max-w-4xl mx-auto">
        <SectionReveal>
          <p className="font-mono text-xs text-accent uppercase tracking-widest mb-6">
            Try it
          </p>
        </SectionReveal>

        <SectionReveal>
          {/* Demo container */}
          <div className="glass rounded-2xl overflow-hidden h-[520px] md:h-[560px]">
            {/* Desktop: split view */}
            <div className="hidden md:grid md:grid-cols-[280px_1fr] h-full">
              <div className="border-r border-line/30">{chatList}</div>
              <div>{chatView}</div>
            </div>

            {/* Mobile: single panel */}
            <div className="md:hidden h-full">
              {showList ? chatList : chatView}
            </div>
          </div>

          {/* Label */}
          <p className="text-tertiary text-xs text-center mt-4">
            This is what the actual app looks like. No screenshots edited.
          </p>
        </SectionReveal>
      </div>
    </section>
  );
}
