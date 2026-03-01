import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DispatchClaimResponse, OpenGramClient } from "./api-client.js";
import { ChatBatchCoordinator, type InboundBatchMessage } from "./chat-batch-coordinator.js";
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

type BatchDispatchInput = {
  chatId: string;
  messageId: string;
  content: string;
  images?: ImageContent[];
  tempFilePaths?: string[];
  tempFileMimes?: string[];
  tempFileUrls?: string[];
};

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
}) => void | Promise<void>;

type ProcessClaimedBatchResult = {
  skipped: boolean;
};

let dispatchSeq = 0;

const TYPING_HEARTBEAT_INTERVAL_MS = 5_000;
const SDK_SKIP_TIMEOUT_MS = 90_000;
const SDK_SKIP_BACKOFF_INITIAL_MS = 250;
const SDK_SKIP_BACKOFF_MAX_MS = 4_000;

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

let batchCoordinator: ChatBatchCoordinator | null = null;

class DispatchSkippedError extends Error {
  constructor(readonly reason: string) {
    super(`dispatch skipped: ${reason}`);
    this.name = "DispatchSkippedError";
  }
}

function isEphemeralEventType(eventType: string): boolean {
  return eventType === "chat.typing" || eventType === "chat.user_typing" || eventType === "message.streaming.chunk";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildBatchedContent(
  messages: InboundBatchMessage[],
  attachmentNamesByMessageId: Map<string, string[]>,
): string {
  if (messages.length <= 1) {
    return messages[0]?.content ?? "";
  }

  return messages
    .map((message, idx) => {
      const body = message.content.trim() ? message.content : "(no text)";
      const names = attachmentNamesByMessageId.get(message.messageId) ?? [];
      const attachmentLine = names.length > 0
        ? `\n[attachments: ${JSON.stringify(names)}]`
        : "";
      return `[Message ${idx + 1}]${attachmentLine}\n${body}`;
    })
    .join("\n\n");
}

function sanitizeFileNameForTempPath(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "attachment";
  }
  const sanitized = trimmed
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return sanitized || "attachment";
}

/**
 * Start the SSE listener for inbound messages from OpenGram.
 * Returns a Promise that resolves when abortSignal fires (lifecycle handle).
 */
export function startInboundListener(params: InboundListenerParams): Promise<void> {
  const { client, cfg, log, abortSignal, reconnectDelayMs, dispatch } = params;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  batchCoordinator = new ChatBatchCoordinator(
    async (chatId, messages) => {
      await processMessageBatch({ chatId, messages, cfg, client, log, dispatch });
    },
    log,
  );

  return new Promise<void>((resolve) => {
    abortSignal.addEventListener("abort", () => resolve(), { once: true });

    function connect() {
      if (abortSignal.aborted) return;

      const es = client.connectSSE({
        ephemeral: true,
        cursor: lastEventCursor,
      });

      es.onopen = () => {
        log?.info("[opengram] SSE connected");
      };

      // Named SSE events (e.g. "event: message.created") don't fire onmessage —
      // they require explicit addEventListener calls per event type.
      const handleSSEEvent = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as { id: string; type: string; payload: Record<string, unknown>; timestamp?: string };
          if (!isEphemeralEventType(data.type)) {
            lastEventCursor = data.id;
          }

          switch (data.type) {
            case "message.created":
              void handleMessageCreated(data, cfg, client, log).catch((err) => {
                log?.warn(`[opengram] Failed to process message.created event: ${String(err)}`);
              });
              break;

            case "request.resolved":
              void handleRequestResolved(data, cfg, client, log, dispatch).catch((err) => {
                log?.warn(`[opengram] Failed to process request.resolved event: ${String(err)}`);
              });
              break;

            case "chat.user_typing": {
              const chatId = parseChatId(data.payload.chatId, "message.created", log);
              if (chatId) {
                batchCoordinator?.onUserTyping(chatId);
              }
              break;
            }
          }
        } catch (err) {
          log?.warn(`[opengram] Failed to parse SSE event: ${err}`);
        }
      };

      // Attach to named event types the server actually sends.
      es.addEventListener("message.created", handleSSEEvent);
      es.addEventListener("request.resolved", handleSSEEvent);
      es.addEventListener("chat.user_typing", handleSSEEvent);
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

  batchCoordinator?.enqueueMessage({
    chatId,
    messageId,
    content,
    traceKind: typeof trace?.kind === "string" ? trace.kind : undefined,
    mediaIds: rawMediaIds,
    receivedAtMs: Date.now(),
  });
}

async function processMessageBatch(args: {
  chatId: string;
  messages: InboundBatchMessage[];
  cfg: OpenClawConfig;
  client: OpenGramClient;
  log?: InboundListenerParams["log"];
  dispatch?: DispatchFn;
}) {
  const { chatId, messages, cfg, client, log, dispatch } = args;
  if (messages.length === 0) {
    return;
  }

  const agentId = await resolveAgentForChat(chatId, cfg, log);

  const collectedImages: ImageContent[] = [];
  const tempFilePaths: string[] = [];
  const tempFileMimes: string[] = [];
  const tempFileUrls: string[] = [];
  const attachmentNamesByMessageId = new Map<string, string[]>();
  const canFetchBuffer = typeof client.fetchMediaAsBuffer === "function";

  for (const message of messages) {
    const namesForMessage: string[] = [];
    for (const mediaId of message.mediaIds) {
      try {
        const mediaWithName = canFetchBuffer ? await client.fetchMediaAsBuffer(mediaId) : null;
        if (mediaWithName) {
          namesForMessage.push(mediaWithName.fileName);
        }

        // Skip image fetch for explicitly non-image media (e.g. kind: "file")
        if (message.traceKind && message.traceKind !== "image") {
          if (!canFetchBuffer) {
            log?.warn(`[opengram] fetchMediaAsBuffer unavailable, skipping non-image media ${mediaId}`);
            continue;
          }
          const media = mediaWithName ?? await client.fetchMediaAsBuffer(mediaId);
          if (media) {
            const base = sanitizeFileNameForTempPath(media.fileName);
            const filePath = path.join(os.tmpdir(), `opengram-${mediaId}-${base}`);
            await fs.writeFile(filePath, media.buffer);
            log?.info(`[opengram] wrote temp file: ${filePath} (${media.mimeType}, ${media.buffer.length} bytes)`);
            tempFilePaths.push(filePath);
            tempFileMimes.push(media.mimeType);
            tempFileUrls.push(client.getMediaUrl(mediaId));
          }
          continue;
        }

        const img = await client.fetchMediaAsImage(mediaId);
        if (img) {
          collectedImages.push(img);
          continue;
        }

        if (!canFetchBuffer) {
          continue;
        }
        const media = await client.fetchMediaAsBuffer(mediaId);
        if (media) {
          const base = sanitizeFileNameForTempPath(media.fileName);
          const filePath = path.join(os.tmpdir(), `opengram-${mediaId}-${base}`);
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
    if (namesForMessage.length > 0) {
      attachmentNamesByMessageId.set(message.messageId, namesForMessage);
    }
  }

  const content = buildBatchedContent(messages, attachmentNamesByMessageId);
  const images: ImageContent[] | undefined = collectedImages.length > 0 ? collectedImages : undefined;
  const messageId = messages.length === 1
    ? messages[0].messageId
    : `batch:${messages[0].messageId}:${messages.length}`;

  log?.info(`[opengram] dispatching batch: chat=${chatId} size=${messages.length} textLen=${content.length} images=${images?.length ?? 0}`);

  try {
    await runInboundDispatch({
      cfg,
      client,
      agentId,
      dispatch,
      log,
      chatId,
      messageId,
      content,
      images,
      tempFilePaths,
      tempFileMimes,
      tempFileUrls,
    });
  } finally {
    for (const p of tempFilePaths) {
      fs.unlink(p).catch(() => {});
    }
  }
}

function buildCompiledContentFromClaimedBatch(batch: DispatchClaimResponse): string {
  if (batch.compiledContent && batch.compiledContent.trim()) {
    return batch.compiledContent;
  }

  if (batch.items.length === 1) {
    const item = batch.items[0];
    return item?.content?.trim() ? item.content : "(no text)";
  }

  return batch.items
    .map((item, index) => {
      const body = item.content?.trim() ? item.content : "(no text)";
      const attachmentLine = item.attachmentNames.length > 0
        ? `\n[attachments: ${JSON.stringify(item.attachmentNames)}]`
        : "";
      return `[Message ${index + 1}]${attachmentLine}\n${body}`;
    })
    .join("\n\n");
}

export async function processClaimedDispatchBatch(args: {
  batch: DispatchClaimResponse;
  cfg: OpenClawConfig;
  client: OpenGramClient;
  log?: InboundListenerParams["log"];
  dispatch?: DispatchFn;
}): Promise<ProcessClaimedBatchResult> {
  const { batch, cfg, client, log, dispatch } = args;

  const senderIds = new Set(
    batch.items
      .map((item) => item.senderId)
      .filter((senderId): senderId is string => typeof senderId === "string" && senderId.trim().length > 0),
  );

  for (const senderId of senderIds) {
    if (senderId === "backend") {
      continue;
    }

    const allowed = await checkDmPolicy(senderId, batch.chatId, cfg, client, log);
    if (!allowed) {
      return { skipped: true };
    }
  }

  trackActiveChat(batch.chatId);
  const agentId = batch.agentIdHint ?? await resolveAgentForChat(batch.chatId, cfg, log);
  const content = buildCompiledContentFromClaimedBatch(batch);

  const collectedImages: ImageContent[] = [];
  const tempFilePaths: string[] = [];
  const tempFileMimes: string[] = [];
  const tempFileUrls: string[] = [];
  const canFetchBuffer = typeof client.fetchMediaAsBuffer === "function";

  for (const attachment of batch.attachments) {
    try {
      if (attachment.kind === "image") {
        const image = await client.fetchMediaAsImage(attachment.mediaId);
        if (image) {
          collectedImages.push(image);
          continue;
        }
      }

      if (!canFetchBuffer) {
        log?.warn(`[opengram] fetchMediaAsBuffer unavailable, skipping attachment ${attachment.mediaId}`);
        continue;
      }

      const media = await client.fetchMediaAsBuffer(attachment.mediaId);
      if (!media) {
        continue;
      }

      const base = sanitizeFileNameForTempPath(media.fileName || attachment.fileName);
      const filePath = path.join(os.tmpdir(), `opengram-${attachment.mediaId}-${base}`);
      await fs.writeFile(filePath, media.buffer);
      tempFilePaths.push(filePath);
      tempFileMimes.push(media.mimeType);
      tempFileUrls.push(client.getMediaUrl(attachment.mediaId));
      log?.info(`[opengram] wrote temp file: ${filePath} (${media.mimeType}, ${media.buffer.length} bytes)`);
    } catch (err) {
      log?.warn(`[opengram] Failed to fetch claimed attachment ${attachment.mediaId}: ${String(err)}`);
    }
  }

  try {
    await runInboundDispatch({
      cfg,
      client,
      agentId,
      dispatch,
      log,
      chatId: batch.chatId,
      messageId: `dispatch:${batch.batchId}`,
      content,
      images: collectedImages.length > 0 ? collectedImages : undefined,
      tempFilePaths,
      tempFileMimes,
      tempFileUrls,
    });
  } finally {
    for (const p of tempFilePaths) {
      fs.unlink(p).catch(() => {});
    }
  }

  return { skipped: false };
}

async function runInboundDispatch(args: {
  cfg: OpenClawConfig;
  client: OpenGramClient;
  agentId: string;
  dispatch?: DispatchFn;
  log?: InboundListenerParams["log"];
} & BatchDispatchInput): Promise<void> {
  const { cfg, client, agentId, dispatch, log, chatId, messageId, content, images, tempFilePaths = [], tempFileMimes = [], tempFileUrls = [] } = args;

  const dispatchId = `${chatId}:${++dispatchSeq}`;

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

  try {
    if (dispatch) {
      await dispatch({ chatId, agentId, messageId, content, mediaUrl: tempFileUrls[0], images, cfg, deliver, onCleanup, onError });
      return;
    }

    await dispatchViaSdkWithRetry({
      chatId,
      agentId,
      messageId,
      content,
      images,
      tempFilePaths,
      tempFileMimes,
      tempFileUrls,
      cfg,
      deliver,
      onError,
      log,
    });
  } catch (err) {
    stopTyping();
    cancelStream(client, dispatchId);
    throw err;
  } finally {
    stopTyping();
  }
}

async function dispatchViaSdkWithRetry(opts: {
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
  log?: InboundListenerParams["log"];
}) {
  const startedAt = Date.now();
  let backoffMs = SDK_SKIP_BACKOFF_INITIAL_MS;

  for (;;) {
    try {
      await dispatchViaSdk(opts);
      return;
    } catch (err) {
      if (!(err instanceof DispatchSkippedError)) {
        throw err;
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= SDK_SKIP_TIMEOUT_MS) {
        throw new Error(`dispatch skipped for too long (${elapsedMs}ms): ${err.reason}`);
      }

      opts.log?.warn(`[opengram] dispatch skipped (${err.reason}), retrying in ${backoffMs}ms`);
      await wait(backoffMs);
      backoffMs = Math.min(SDK_SKIP_BACKOFF_MAX_MS, backoffMs * 2);
    }
  }
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

  await runInboundDispatch({
    cfg,
    client,
    agentId,
    dispatch,
    log,
    chatId,
    messageId: `req:${requestId}:resolved`,
    content: body,
  });
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

  let skippedReason: string | null = null;

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx,
    cfg,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload: { text?: string; mediaUrl?: string }, info: { kind: DeliverKind }) => {
        log?.info(
          `[opengram] deliver called: kind=${info.kind} textLen=${payload.text?.length ?? 0} hasMedia=${Boolean(payload.mediaUrl)}`,
        );
        await deliver(
          { text: payload.text, mediaUrl: payload.mediaUrl },
          { kind: info.kind },
        );
      },
      onSkip: (payload: { text?: string; mediaUrl?: string }, info: { kind: string; reason: string }) => {
        skippedReason = info.reason;
        log?.warn(
          `[opengram] deliver skipped: kind=${info.kind} reason=${info.reason} textLen=${payload.text?.length ?? 0} hasMedia=${Boolean(payload.mediaUrl)}`,
        );
      },
      onError: (err: unknown, info: { kind: string }) => {
        log?.error(`[opengram] ${info.kind} reply failed: ${String(err)}`);
        onError(err);
      },
    },
    replyOptions: {
      onModelSelected,
      ...(images ? { images } : {}),
    },
  });

  if (skippedReason) {
    throw new DispatchSkippedError(skippedReason);
  }
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
      const normalizedFinalText =
        typeof replyPayload.text === "string" && replyPayload.text.trim()
          ? replyPayload.text
          : undefined;
      const hasTextField = typeof replyPayload.text === "string";

      if (hasTextField) {
        const wasStreaming = await finalizeStream(client, dispatchId, normalizedFinalText);
        if (!wasStreaming && normalizedFinalText) {
          // No active stream — send as a normal message.
          await client.createMessage(chatId, {
            role: "agent",
            senderId: agentId,
            content: normalizedFinalText,
          });
        }
      } else {
        // Media-only final reply — cancel the eager stream.
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
  batchCoordinator?.resetForTests();
}
