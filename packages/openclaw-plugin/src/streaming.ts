import type { OpenGramClient } from "./api-client.js";

/**
 * Per-dispatch streaming state keyed by dispatchId (not chatId).
 * Using dispatchId prevents collisions when concurrent replies target the same chat
 * (e.g., tool result + text reply, or overlapping heartbeat).
 */
const activeStreams = new Map<string, StreamState>();

type StreamState = {
  chatId: string;
  agentId: string;
  messageId: string;
  /** How much accumulated text we've already sent as chunks. */
  lastSentLength: number;
  /** Full accumulated text from block replies — used as fallback when final text is empty. */
  accumulatedText: string;
};

/**
 * Called from deliver(kind: "block") in the inbound handler.
 * Receives accumulated text from OpenClaw's block streaming, diffs against
 * the last sent length, and sends only the delta to OpenGram's chunk API.
 *
 * @param dispatchId Unique per inbound message processing — prevents concurrent collisions.
 * @param payload    The reply payload containing accumulated text.
 */
export async function handleBlockReply(
  client: OpenGramClient,
  chatId: string,
  agentId: string,
  dispatchId: string,
  payload: { text?: string },
): Promise<void> {
  const text = payload.text ?? "";
  let stream = activeStreams.get(dispatchId);

  if (!stream) {
    // First block reply: create a streaming message in OpenGram
    const message = await client.createMessage(chatId, {
      role: "agent",
      senderId: agentId,
      streaming: true,
    });
    stream = { chatId, agentId, messageId: message.id, lastSentLength: 0, accumulatedText: "" };
    activeStreams.set(dispatchId, stream);
  }

  stream.accumulatedText = text;

  // Extract delta: accumulated text minus what we already sent.
  // Update lastSentLength BEFORE await to prevent race condition:
  // if a second block reply arrives while sendChunk is in-flight,
  // it would see stale lastSentLength and compute overlapping delta.
  if (text.length > stream.lastSentLength) {
    const delta = text.substring(stream.lastSentLength);
    stream.lastSentLength = text.length;
    await client.sendChunk(stream.messageId, delta);
  }
}

/**
 * Called when the agent reply is finalized (from deliver(kind: "final")).
 * Completes the streaming message with final text, or (when no final text is
 * provided) finalizes from streamed chunks.
 *
 * @returns true if a stream was active and completed, false if no stream existed.
 */
export async function finalizeStream(
  client: OpenGramClient,
  dispatchId: string,
  finalText?: string,
): Promise<boolean> {
  const stream = activeStreams.get(dispatchId);
  if (!stream) return false;

  try {
    if (finalText === undefined) {
      if (stream.lastSentLength > 0) {
        await client.completeMessage(stream.messageId, stream.accumulatedText || undefined);
      } else {
        await client.cancelMessage(stream.messageId);
      }
    } else {
      await client.completeMessage(stream.messageId, finalText);
    }
  } catch {
    // completeMessage can fail with 409 Conflict when the OpenGram server's
    // stale-streaming sweeper has already cancelled the message (e.g. no chunks
    // sent for >60s during extended thinking). Fall back to a regular message
    // so the reply text is not lost.
    if (finalText && finalText.trim()) {
      await client.createMessage(stream.chatId, {
        role: "agent",
        senderId: stream.agentId,
        content: finalText,
      });
    }
  }
  activeStreams.delete(dispatchId);
  return true;
}

/**
 * Called on error/abort to cancel any active stream for a dispatch.
 * Fire-and-forget: errors are silently swallowed.
 */
export function cancelStream(client: OpenGramClient, dispatchId: string): void {
  const stream = activeStreams.get(dispatchId);
  if (stream) {
    client.cancelMessage(stream.messageId).catch(() => {});
    activeStreams.delete(dispatchId);
  }
}

/**
 * Pre-seed the activeStreams map so that handleBlockReply reuses the existing
 * message instead of creating a new one. Called eagerly when the inbound
 * handler starts processing, before the SDK dispatch, so the frontend sees
 * stream_state:'streaming' immediately (typing indicator).
 */
export function initStream(dispatchId: string, chatId: string, messageId: string, agentId: string): void {
  activeStreams.set(dispatchId, { chatId, agentId, messageId, lastSentLength: 0, accumulatedText: "" });
}

/**
 * Check if a dispatch currently has an active stream.
 * Useful for testing.
 */
export function hasActiveStream(dispatchId: string): boolean {
  return activeStreams.has(dispatchId);
}

/**
 * Cancel all active streams for a given chat.
 * Used as a safety net when superseding dispatches — ensures no orphaned
 * streaming messages remain for the chat.
 */
export function cancelAllStreamsForChat(client: OpenGramClient, chatId: string): void {
  for (const [dispatchId, stream] of activeStreams) {
    if (stream.chatId === chatId) {
      client.cancelMessage(stream.messageId).catch(() => {});
      activeStreams.delete(dispatchId);
    }
  }
}

/**
 * Clear all active streams. Only for testing.
 */
export function clearActiveStreamsForTests(): void {
  activeStreams.clear();
}
