import type { OpenGramClient } from "./api-client.js";
import { resolveAgentForChat, trackActiveChat } from "./chat-manager.js";
import { downloadMedia } from "./media.js";
import { cancelStream, finalizeStream, handleBlockReply } from "./streaming.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";

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

export type DispatchFn = (opts: {
  chatId: string;
  agentId: string;
  messageId: string;
  content: string;
  cfg: OpenClawConfig;
  deliver: (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void>;
  onCleanup: () => void;
  onError: (err: unknown) => void;
}) => void;

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

      es.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          lastEventCursor = data.id;

          switch (data.type) {
            case "message.created":
              handleMessageCreated(data, cfg, client, log, dispatch);
              break;

            case "request.resolved":
              handleRequestResolved(data, cfg, client, log, dispatch);
              break;
          }
        } catch (err) {
          log?.warn(`[opengram] Failed to parse SSE event: ${err}`);
        }
      };

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

  const chatId = payload.chatId as string;
  trackActiveChat(chatId);

  const agentId = await resolveAgentForChat(chatId, cfg);
  const content = (payload.content as string) ?? "";

  // Unique per dispatch to isolate concurrent stream state.
  const dispatchId = `${chatId}:${Date.now()}`;

  const deliver = buildDeliver(client, chatId, agentId, dispatchId, log);
  const onCleanup = () => cancelStream(client, dispatchId);
  const onError = (err: unknown) => {
    log?.error(`[opengram] Reply dispatch error: ${err}`);
    cancelStream(client, dispatchId);
  };

  if (dispatch) {
    dispatch({ chatId, agentId, messageId, content, cfg, deliver, onCleanup, onError });
  }
  // In production, this would call dispatchInboundMessageWithBufferedDispatcher
  // from openclaw/plugin-sdk. The dispatch function is injected to allow testing.
}

async function handleRequestResolved(
  data: { payload: Record<string, unknown> },
  cfg: OpenClawConfig,
  client: OpenGramClient,
  log?: InboundListenerParams["log"],
  dispatch?: DispatchFn,
) {
  const payload = data.payload;
  const chatId = payload.chatId as string;
  const requestId = payload.requestId as string;
  const body = formatRequestResolution(payload);

  const agentId = await resolveAgentForChat(chatId, cfg);
  const dispatchId = `req:${requestId}`;

  const deliver = buildDeliver(client, chatId, agentId, dispatchId, log);
  const onCleanup = () => cancelStream(client, dispatchId);
  const onError = (err: unknown) => {
    log?.error(`[opengram] Reply dispatch error: ${err}`);
  };

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
  log?: InboundListenerParams["log"],
): (payload: ReplyPayload, meta: { kind: DeliverKind }) => Promise<void> {
  return async (replyPayload, { kind }) => {
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
