import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenGramClient } from "./api-client.js";
import { maybeAutoRename } from "./auto-rename.js";
import { enqueueOrSupersede, isSuperseded, setDispatchCleanup } from "./chat-queue.js";
import { resolveAgentForChat, trackActiveChat } from "./chat-manager.js";
import { resolveOpenGramAccount, type OpenGramChannelConfig } from "./config.js";
import { downloadMedia } from "./media.js";
import { getOpenGramRuntime } from "./runtime.js";
import { cancelStream, finalizeStream, handleBlockReply, initStream } from "./streaming.js";
import { createReplyPrefixOptions, type OpenClawConfig } from "openclaw/plugin-sdk";

export type InboundListenerParams = {
  client: OpenGramClient;
  cfg: OpenClawConfig;
  abortSignal: AbortSignal;
  log?: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  reconnectDelayMs: number;
  /** Injected dispatch function — allows tests to supply a mock. */
  dispatch?: DispatchFn;
};

/**
 * The deliver callback signature expected by the buffered dispatcher.
 * `kind` differentiates block (streaming) from final (complete) and tool replies.
 */
export type DeliverKind = "block" | "final" | "tool";

export type ReplyPayload = {
  text?: string;
  mediaUrl?: string;
};

type ImageContent = { type: "image"; data: string; mimeType: string };

export type DispatchFn = (opts: {
  chatId: string;
  agentId: string;
  messageId: string;
  content: string;
  mediaUrl?: string;
  images?: ImageContent[];
  cfg: OpenClawConfig;
  deliver: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;
  onCleanup: () => void;
  onError: (err: unknown) => void;
}) => void;

let dispatchSeq = 0;

const TYPING_HEARTBEAT_INTERVAL_MS = 5_000;

function startTypingHeartbeat(client: OpenGramClient, chatId: string, agentId: string): () => void {
  void client.sendTyping(chatId, agentId);
  const timer = setInterval(() => { void client.sendTyping(chatId, agentId); }, TYPING_HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

// Track last-seen event ID for cursor-based catch-up
let lastEventCursor: string | undefined;

// Deduplication set (prevent re-dispatch on SSE reconnect replay)
const processedMessageIds = new Set<string>();
const MAX_DEDUP_SIZE = 10000;

/**
 * Start the SSE listener for inbound messages from OpenGram.
 * Returns a Promise that resolves when abortSignal fires (lifecycle handle).
 */
export function startInboundListener(params: InboundListenerParams): Promise<void> {
  const { client, cfg, log, abortSignal, reconnectDelayMs, dispatch } = params;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<void>((resolve) => {
    abortSignal.addEventListener("abort", () => resolve(), { once: true });

    function connect() {
      if (abortSignal.aborted) return;

      const es = client.connectSSE({
        ephemeral: false,
        cursor: lastEventCursor,
      });

      es.onopen = () => {
        log?.info("[opengram] SSE connected");
      };

      // Named SSE events (e.g. "event: message.created") don't fire onmessage —
      // they require explicit addEventListener calls per event type.
      const handleSSEEvent = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          lastEventCursor = data.id;

          switch (data.type) {
            case "message.created":
              void handleMessageCreated(data, cfg, client, log, dispatch).catch((err) => {
                log?.warn(`[opengram] Failed to process message.created event: ${String(err)}`);
              });
              break;

            case "request.resolved":
              void handleRequestResolved(data, cfg, client, log, dispatch).catch((err) => {
                log?.warn(`[opengram] Failed to process request.resolved event: ${String(err)}`);
              });
              break;
          }
        } catch (err) {
          log?.warn(`[opengram] Failed to parse SSE event: ${err}`);
        }
      };

      // Attach to named event types the server actually sends.
      es.addEventListener("message.created", handleSSEEvent);
      es.addEventListener("request.resolved", handleSSEEvent);
      // Fallback for any unnamed events (future-proofing).
      es.onmessage = handleSSEEvent;

      es.onerror = (event: Event & { code?: number; message?: string }) => {
        es.close();
        if (event.code === 401 || event.code === 403) {
          log?.error(`[opengram] SSE auth failed (${event.code}). Check instanceSecret.`);
          return;
        }
        log?.warn(`[opengram] SSE connection lost (${event.message ?? "unknown error"}), reconnecting...`);
        if (!abortSignal.aborted) {
          reconnectTimer = setTimeout(connect, reconnectDelayMs);
        }
      };

      abortSignal.addEventListener(
        "abort",
        () => {
          es.close();
          if (reconnectTimer) clearTimeout(reconnectTimer);
        },
        { once: true },
      );
    }

    connect();
  });
}

/**
 * Check DM policy for an inbound sender. Returns true if the message should
 * be dispatched, false if it should be dropped.
 */
async function checkDmPolicy(
  senderId: string,
  chatId: string,
  cfg: OpenClawConfig,
  client: OpenGramClient,
  log?: InboundListenerParams["log"],
): Promise<boolean> {
  const account = resolveOpenGramAccount(cfg);
  const policy = account.config.dmPolicy;

  if (policy === "open") return true;
  if (policy === "disabled") {
    log?.info(`[opengram] DM policy is disabled, dropping message from ${senderId}`);
    return false;
  }

  // For pairing/allowlist, build effective allowlist from store + config.
  let effectiveAllowlist: string[];
  try {
    const core = getOpenGramRuntime();
    const storeEntries = await core.channel.pairing.readAllowFromStore("opengram");
    effectiveAllowlist = [...storeEntries, ...account.config.allowFrom];
  } catch {
    // Runtime not available (e.g. test context with injected dispatch) — config only.
    effectiveAllowlist = [...account.config.allowFrom];
  }

  if (effectiveAllowlist.includes("*") || effectiveAllowlist.includes(senderId)) {
    return true;
  }

  if (policy === "pairing") {
    try {
      const core = getOpenGramRuntime();
      const { code } = await core.channel.pairing.upsertPairingRequest({
        channel: "opengram",
        id: senderId,
      });
      const pairingReply = core.channel.pairing.buildPairingReply({
        channel: "opengram",
        idLine: `Sender: ${senderId}`,
        code,
      });
      await client.createMessage(chatId, {
        role: "system",
        senderId: "openclaw",
        content: pairingReply,
      });
    } catch (err) {
      log?.warn(`[opengram] Failed to create pairing request for ${senderId}: ${err}`);
    }
    return false;
  }

  // allowlist mode — sender not in list.
  log?.info(`[opengram] Sender ${senderId} not in allowlist, dropping message`);
  return false;
}

async function handleMessageCreated(
  data: { payload: Record<string, unknown>; timestamp?: string },
  cfg: OpenClawConfig,
  client: OpenGramClient,
  log?: InboundListenerParams["log"],
  dispatch?: DispatchFn,
) {
  const payload = data.payload;

  // Only process user messages to prevent infinite loops.
  if (payload.role !== "user") return;

  const messageId = payload.messageId as string;
  if (processedMessageIds.has(messageId)) return;
  processedMessageIds.add(messageId);
  if (processedMessageIds.size > MAX_DEDUP_SIZE) {
    const first = processedMessageIds.values().next().value!;
    processedMessageIds.delete(first);
  }

  const chatId = parseChatId(payload.chatId, "message.created", log);
  if (!chatId) return;
  trackActiveChat(chatId);

  const senderId = (payload.senderId as string) ?? "user:primary";
  const allowed = await checkDmPolicy(senderId, chatId, cfg, client, log);
  if (!allowed) return;

  const agentId = await resolveAgentForChat(chatId, cfg, log);
  const content = typeof payload.contentFinal === "string"
    ? payload.contentFinal
    : typeof payload.content_final === "string"
      ? payload.content_final
      : typeof payload.content === "string"
        ? payload.content
        : "";

  const trace = payload.trace as Record<string, unknown> | null | undefined;

  // Support both new array format (trace.mediaIds) and legacy single (trace.mediaId)
  const rawMediaIds: string[] = (() => {
    if (Array.isArray(trace?.mediaIds)) {
      return (trace.mediaIds as unknown[]).filter((id): id is string => typeof id === "string");
    }
    if (typeof trace?.mediaId === "string") {
      return [trace.mediaId];
    }
    return [];
  })();

  log?.info(`[opengram] inbound trace: mediaIds=[${rawMediaIds.join(", ")}]`);

  const collectedImages: ImageContent[] = [];
  const tempFilePaths: string[] = [];
  const tempFileMimes: string[] = [];
  const tempFileUrls: string[] = [];

  for (const mediaId of rawMediaIds) {
    try {
      const img = await client.fetchMediaAsImage(mediaId);
      if (img) {
        log?.info(`[opengram] fetchMediaAsImage: got ${img.mimeType} (${img.data.length} chars) for ${mediaId}`);
        collectedImages.push(img);
        continue;
      }
      // Not an image — download to temp file
      const media = await client.fetchMediaAsBuffer(mediaId);
      if (media) {
        const ext = path.extname(media.fileName) || "";
        const filePath = path.join(os.tmpdir(), `opengram-${mediaId}${ext}`);
        await fs.writeFile(filePath, media.buffer);
        log?.info(`[opengram] wrote temp file: ${filePath} (${media.mimeType}, ${media.buffer.length} bytes)`);
        tempFilePaths.push(filePath);
        tempFileMimes.push(media.mimeType);
        tempFileUrls.push(client.getMediaUrl(mediaId));
      }
    } catch (err) {
      log?.warn(`[opengram] Failed to fetch inbound media ${mediaId}: ${err}`);
    }
  }

  // Keep legacy singular vars for the mock dispatch path (backwards-compatible)
  const mediaUrl = tempFileUrls[0];
  const tempFilePath = tempFilePaths[0];
  const tempFileMime = tempFileMimes[0];
  const images: ImageContent[] | undefined = collectedImages.length > 0 ? collectedImages : undefined;

  // Unique per dispatch to isolate concurrent stream state.
  // Monotonic counter avoids collision if two messages arrive in the same ms.
  const dispatchId = `${chatId}:${++dispatchSeq}`;

  log?.info(`[opengram] dispatching: content="${content.slice(0, 40)}" images=${images?.length ?? 0}`);

  // Enqueue through the per-chat queue. If another dispatch is active for
  // this chat, it gets superseded (typing bubble + stream cancelled).
  enqueueOrSupersede(
    chatId,
    dispatchId,
    async () => {
      // Eagerly create a streaming message so the frontend shows typing
      // indicator immediately, before the SDK starts producing content.
      const streamingMsg = await client.createMessage(chatId, {
        role: "agent",
        senderId: agentId,
        streaming: true,
      });
      initStream(dispatchId, chatId, streamingMsg.id, agentId);

      const account = resolveOpenGramAccount(cfg);
      const stopTyping = startTypingHeartbeat(client, chatId, agentId);
      const deliver = buildDeliver(client, chatId, agentId, dispatchId, account.config, log);
      const onCleanup = () => { stopTyping(); cancelStream(client, dispatchId); };
      const onError = (err: unknown) => {
        stopTyping();
        log?.error(`[opengram] Reply dispatch error: ${err}`);
        cancelStream(client, dispatchId);
      };

      // Register cleanup so the queue can cancel this dispatch if superseded.
      setDispatchCleanup(chatId, dispatchId, onCleanup);

      try {
        if (dispatch) {
          dispatch({ chatId, agentId, messageId, content, mediaUrl, images, cfg, deliver, onCleanup, onError });
        } else {
          await dispatchViaSdk({ chatId, agentId, messageId, content, images, tempFilePaths, tempFileMimes, tempFileUrls, cfg, deliver, onError, onSkip: () => { stopTyping(); cancelStream(client, dispatchId); }, log });
        }
      } catch (err) {
        stopTyping();
        cancelStream(client, dispatchId);
        throw err;
      } finally {
        stopTyping();
        for (const p of tempFilePaths) {
          fs.unlink(p).catch(() => {});
        }
      }
    },
    client,
    log,
  );
}

async function handleRequestResolved(
  data: { payload: Record<string, unknown> },
  cfg: OpenClawConfig,
  client: OpenGramClient,
  log?: InboundListenerParams["log"],
  dispatch?: DispatchFn,
) {
  const payload = data.payload;
  const chatId = parseChatId(payload.chatId, "request.resolved", log);
  if (!chatId) return;

  const senderId = (payload.senderId as string) ?? "user:primary";
  const allowed = await checkDmPolicy(senderId, chatId, cfg, client, log);
  if (!allowed) return;

  const requestId = payload.requestId as string;
  const body = formatRequestResolution(payload);

  const agentId = await resolveAgentForChat(chatId, cfg, log);
  const dispatchId = `req:${requestId}`;

  enqueueOrSupersede(
    chatId,
    dispatchId,
    async () => {
      // Eagerly create a streaming message so the frontend shows typing
      // indicator immediately, before the SDK starts producing content.
      const streamingMsg = await client.createMessage(chatId, {
        role: "agent",
        senderId: agentId,
        streaming: true,
      });
      initStream(dispatchId, chatId, streamingMsg.id, agentId);

      const account = resolveOpenGramAccount(cfg);
      const stopTyping = startTypingHeartbeat(client, chatId, agentId);
      const deliver = buildDeliver(client, chatId, agentId, dispatchId, account.config, log);
      const onCleanup = () => { stopTyping(); cancelStream(client, dispatchId); };
      const onError = (err: unknown) => {
        stopTyping();
        log?.error(`[opengram] Reply dispatch error: ${err}`);
        cancelStream(client, dispatchId);
      };

      // Register cleanup so the queue can cancel this dispatch if superseded.
      setDispatchCleanup(chatId, dispatchId, onCleanup);

      try {
        if (dispatch) {
          dispatch({
            chatId,
            agentId,
            messageId: `req:${requestId}:resolved`,
            content: body,
            cfg,
            deliver,
            onCleanup,
            onError,
          });
        } else {
          await dispatchViaSdk({
            chatId,
            agentId,
            messageId: `req:${requestId}:resolved`,
            content: body,
            cfg,
            deliver,
            onError: (err) => { stopTyping(); log?.error(`[opengram] Reply dispatch error: ${err}`); },
            onSkip: () => { stopTyping(); cancelStream(client, dispatchId); },
            log,
          });
        }
      } catch (err) {
        stopTyping();
        cancelStream(client, dispatchId);
        throw err;
      } finally {
        stopTyping();
      }
    },
    client,
    log,
  );
}

const CHANNEL_ID = "opengram";
function normalizeAgentIdForSessionKey(agentId: string): string {
  const trimmed = agentId.trim().toLowerCase();
  if (!trimmed) {
    return "main";
  }
  return trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "") || "main";
}

/**
 * Build a per-chat session key. We intentionally ignore route.sessionKey from
 * OpenClaw's resolveAgentRoute because OpenGram requires per-chat session
 * isolation — a shared session key (e.g. dmScope="main" → "agent:id:main")
 * would route all chats into one agent session, causing cross-chat reply bleed.
 * See KAI-232.
 */
function buildSessionKey(chatId: string, agentId: string): string {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) {
    throw new Error("[opengram] Cannot dispatch inbound event without chatId");
  }

  const normalizedAgentId = normalizeAgentIdForSessionKey(agentId);
  return `agent:${normalizedAgentId}:${CHANNEL_ID}:direct:${normalizedChatId.toLowerCase()}`;
}

/**
 * Production dispatch path — calls the SDK's buffered block dispatcher
 * so the agent actually processes the inbound message and replies.
 */
async function dispatchViaSdk(opts: {
  chatId: string;
  agentId: string;
  messageId: string;
  content: string;
  images?: ImageContent[];
  tempFilePaths?: string[];
  tempFileMimes?: string[];
  tempFileUrls?: string[];
  cfg: OpenClawConfig;
  deliver: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;
  onError: (err: unknown) => void;
  onSkip?: () => void;
  log?: InboundListenerParams["log"];
}): Promise<void> {
  const { chatId, agentId, messageId, content, images, tempFilePaths = [], tempFileMimes = [], tempFileUrls = [], cfg, deliver, onError, log } = opts;
  const core = getOpenGramRuntime();

  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: CHANNEL_ID,
    peer: { kind: "direct", id: chatId },
  });
  const sessionKey = buildSessionKey(chatId, agentId);
  log?.info(
    `[opengram] dispatch route: chatId=${chatId} routeAgent=${route.agentId} selectedAgent=${agentId} matchedBy=${route.matchedBy} sessionKey=${sessionKey}`,
  );

  const ctx = core.channel.reply.finalizeInboundContext({
    Body: content,
    RawBody: content,
    CommandBody: content,
    From: `opengram:${chatId}`,
    To: `opengram:${chatId}`,
    SessionKey: sessionKey,
    ChatType: "direct",
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: messageId,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `opengram:${chatId}`,
    CommandAuthorized: true,
    ...(tempFilePaths.length > 1
      ? { MediaPaths: tempFilePaths, MediaUrls: tempFileUrls, MediaTypes: tempFileMimes }
      : tempFilePaths.length === 1
        ? { MediaPath: tempFilePaths[0], MediaUrl: tempFileUrls[0], MediaType: tempFileMimes[0] }
        : tempFileUrls[0]
          ? { MediaUrl: tempFileUrls[0] }
          : {}),
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId,
    channel: CHANNEL_ID,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx,
    cfg,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload, info) => {
        log?.info(
          `[opengram] deliver called: kind=${info.kind} textLen=${payload.text?.length ?? 0} hasMedia=${Boolean(payload.mediaUrl)}`,
        );
        await deliver(
          { text: payload.text, mediaUrl: payload.mediaUrl },
          { kind: info.kind },
        );
      },
      onSkip: (payload, info) => {
        log?.warn(
          `[opengram] deliver skipped: kind=${info.kind} reason=${info.reason} textLen=${payload.text?.length ?? 0} hasMedia=${Boolean(payload.mediaUrl)}`,
        );
        opts.onSkip?.();
      },
      onError: (err, info) => {
        log?.error(`[opengram] ${info.kind} reply failed: ${String(err)}`);
        onError(err);
      },
    },
    replyOptions: {
      onModelSelected,
      ...(images ? { images } : {}),
    },
  });
}

/**
 * Build a deliver callback that integrates streaming (block replies),
 * final messages, and tool messages.
 */
function buildDeliver(
  client: OpenGramClient,
  chatId: string,
  agentId: string,
  dispatchId: string,
  cfg: OpenGramChannelConfig,
  log?: InboundListenerParams["log"],
): (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void> {
  return async (replyPayload, { kind }) => {
    // Supersede guard: if this dispatch was superseded by a newer message,
    // silently drop late deliver callbacks to prevent ghost messages.
    if (isSuperseded(dispatchId)) {
      log?.info(`[opengram] deliver no-op: dispatch ${dispatchId} was superseded (kind=${kind})`);
      return;
    }

    log?.info(
      `[opengram] buildDeliver called: kind=${kind} textLen=${replyPayload.text?.length ?? 0} hasMedia=${Boolean(replyPayload.mediaUrl)}`,
    );

    // Skip reasoning/thinking messages — they are internal chain-of-thought
    // delivered as a separate "final" before the actual answer.
    if (!cfg.showReasoningMessages && replyPayload.text?.trimStart().startsWith("Reasoning:\n")) {
      log?.info("[opengram] skipping reasoning message");
      return;
    }

    if (kind === "block") {
      await handleBlockReply(client, chatId, agentId, dispatchId, replyPayload);
      return;
    }

    if (kind === "final") {
      if (replyPayload.text) {
        const wasStreaming = await finalizeStream(client, dispatchId, replyPayload.text);
        if (!wasStreaming) {
          // No active stream — send as a normal message.
          await client.createMessage(chatId, {
            role: "agent",
            senderId: agentId,
            content: replyPayload.text,
          });
        }
      } else {
        // No text in final reply (media-only or empty) — cancel the eager stream.
        cancelStream(client, dispatchId);
      }
      if (replyPayload.mediaUrl) {
        const { buffer, filename, contentType } = await downloadMedia(replyPayload.mediaUrl);
        const msg = await client.createMessage(chatId, {
          role: "agent",
          senderId: agentId,
          content: "",
        });
        await client.uploadMedia(chatId, { file: buffer, filename, contentType, messageId: msg.id });
      }
      // Fire-and-forget: attempt auto-rename after first agent response.
      maybeAutoRename({ chatId, cfg, client, log }).catch((err) => {
        log?.warn(`[opengram:auto-rename] Unexpected error: ${String(err)}`);
      });
      return;
    }

    // kind === "tool"
    if (replyPayload.text) {
      await client.createMessage(chatId, {
        role: "tool",
        senderId: agentId,
        content: replyPayload.text,
      });
    }
  };
}

function parseChatId(
  rawChatId: unknown,
  eventType: "message.created" | "request.resolved",
  log?: InboundListenerParams["log"],
): string | null {
  if (typeof rawChatId !== "string") {
    log?.warn(`[opengram] Skipping ${eventType}: invalid chatId type`);
    return null;
  }

  const chatId = rawChatId.trim();
  if (!chatId) {
    log?.warn(`[opengram] Skipping ${eventType}: empty chatId`);
    return null;
  }

  return chatId;
}

function formatRequestResolution(payload: Record<string, unknown>): string {
  const { type, title, resolutionPayload } = payload as {
    type: string;
    title: string;
    resolutionPayload: Record<string, unknown>;
  };
  switch (type) {
    case "choice":
      return `[Request resolved: "${title}"] Selected: ${(resolutionPayload.selectedOptionIds as string[])?.join(", ")}`;
    case "text_input":
      return `[Request resolved: "${title}"] Response: ${resolutionPayload.text}`;
    case "form":
      return `[Request resolved: "${title}"] Form values: ${JSON.stringify(resolutionPayload.values)}`;
    default:
      return `[Request resolved: "${title}"] ${JSON.stringify(resolutionPayload)}`;
  }
}

/** Clear dedup set. Only for testing. */
export function clearProcessedIdsForTests(): void {
  processedMessageIds.clear();
  lastEventCursor = undefined;
}
