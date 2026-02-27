import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import { parseJsonBody, toErrorResponse } from '@/src/api/http';
import { applyWriteMiddlewares } from '@/src/api/write-controls';
import { createMessage } from '@/src/services/messages-service';
import { subscribeToEvents } from '@/src/services/events-service';
import type { EventEnvelope } from '@/src/services/events-service';
import { getDb } from '@/src/db/client';

type StreamRequestBody = {
  message?: string;
  attachmentIds?: string[];
  modelId?: string;
};

const chatV2 = new Hono();

const TIMEOUT_MS = 120_000;
const TEXT_PART_ID = 'text-0';
const CHAT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function sseChunk(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function writeSequence(
  s: { write: (data: string) => Promise<void> },
  chunks: string[],
): Promise<void> {
  for (const chunk of chunks) {
    await s.write(chunk);
  }
}

// POST /api/v2/chats/:chatId/stream
// Bridges our async SSE model → AI SDK v6 UIMessage stream protocol
chatV2.post('/:chatId/stream', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');

    // Validate chatId format
    if (!CHAT_ID_RE.test(chatId)) {
      return c.json({ error: 'Invalid chat ID format' }, 400);
    }

    // Validate chat exists
    const db = getDb();
    const chat = db
      .prepare('SELECT id FROM chats WHERE id = ? AND is_archived = 0')
      .get(chatId) as { id: string } | undefined;
    if (!chat) {
      return c.json({ error: 'Chat not found' }, 404);
    }

    // Parse body
    const body = await parseJsonBody<StreamRequestBody>(c.req.raw);
    if (!body.message?.trim() && (!body.attachmentIds || body.attachmentIds.length === 0)) {
      return c.json({ error: 'Message content or attachments required' }, 400);
    }

    // Set AI SDK v6 UIMessage stream SSE headers
    c.header('Content-Type', 'text/event-stream; charset=utf-8');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Vercel-AI-UI-Message-Stream', 'v1');
    c.header('X-Accel-Buffering', 'no');

    return stream(c, async (s) => {
      let agentMessageId: string | null = null;
      let completed = false;
      let resolveStream: (() => void) | null = null;
      let timeoutHandle: ReturnType<typeof setTimeout>;

      const finish = () => {
        if (!resolveStream) return;
        const fn = resolveStream;
        resolveStream = null;
        clearTimeout(timeoutHandle);
        unsubscribe();
        fn();
      };

      // Subscribe BEFORE creating the message to avoid race condition
      // where agent responds between message creation and subscription
      const unsubscribe = subscribeToEvents(true, (event: EventEnvelope) => {
        if (completed) return;

        const payload = event.payload;

        // Watch for agent message creation in this chat
        if (event.type === 'message.created' && payload.chatId === chatId) {
          if (payload.role === 'agent' && payload.streamState === 'streaming') {
            agentMessageId = payload.messageId as string;
            void writeSequence(s, [
              sseChunk({ type: 'start' }),
              sseChunk({ type: 'start-step' }),
              sseChunk({ type: 'text-start', id: TEXT_PART_ID }),
            ]);
          }

          // Non-streaming agent message (already complete)
          if (payload.role === 'agent' && payload.streamState !== 'streaming') {
            const content = (payload.contentFinal as string) || '';
            completed = true;
            const chunks = [
              sseChunk({ type: 'start' }),
              sseChunk({ type: 'start-step' }),
              sseChunk({ type: 'text-start', id: TEXT_PART_ID }),
            ];
            if (content) {
              chunks.push(sseChunk({ type: 'text-delta', delta: content, id: TEXT_PART_ID }));
            }
            chunks.push(
              sseChunk({ type: 'text-end', id: TEXT_PART_ID }),
              sseChunk({ type: 'finish-step' }),
              sseChunk({ type: 'finish', finishReason: 'stop' }),
              'data: [DONE]\n\n',
            );
            void writeSequence(s, chunks).then(finish).catch(finish);
          }
        }

        // Stream chunks from the agent message
        if (
          event.type === 'message.streaming.chunk' &&
          agentMessageId &&
          payload.messageId === agentMessageId
        ) {
          const delta = payload.deltaText as string;
          if (delta) {
            // Write errors on ephemeral deltas are intentionally ignored —
            // abort handler and timeout ensure cleanup on client disconnect.
            void s.write(sseChunk({ type: 'text-delta', delta, id: TEXT_PART_ID }));
          }
        }

        // Complete when streaming is done
        if (
          event.type === 'message.streaming.complete' &&
          agentMessageId &&
          payload.messageId === agentMessageId
        ) {
          completed = true;
          void writeSequence(s, [
            sseChunk({ type: 'text-end', id: TEXT_PART_ID }),
            sseChunk({ type: 'finish-step' }),
            sseChunk({ type: 'finish', finishReason: 'stop' }),
            'data: [DONE]\n\n',
          ]).then(finish).catch(finish);
        }
      });

      // Now create the user message (triggers agent processing)
      createMessage(chatId, {
        role: 'user',
        senderId: 'user:primary',
        content: body.message?.trim() || '',
        streaming: false,
        modelId: body.modelId,
        ...(body.attachmentIds?.length
          ? { trace: { mediaIds: body.attachmentIds } }
          : {}),
      });

      // Wait for completion, timeout, or disconnect
      await new Promise<void>((resolve) => {
        resolveStream = resolve;

        // Timeout: resolve directly from setTimeout callback (no polling)
        timeoutHandle = setTimeout(() => {
          if (completed) return;
          completed = true;
          const chunks: string[] = [];
          if (agentMessageId) {
            chunks.push(
              sseChunk({ type: 'text-end', id: TEXT_PART_ID }),
              sseChunk({ type: 'finish-step' }),
            );
          }
          chunks.push(
            sseChunk({ type: 'finish', finishReason: 'error' }),
            'data: [DONE]\n\n',
          );
          void writeSequence(s, chunks).then(finish).catch(finish);
        }, TIMEOUT_MS);

        // Handle client disconnect
        c.req.raw.signal.addEventListener(
          'abort',
          () => {
            completed = true;
            finish();
          },
          { once: true },
        );
      });

      // Safety: ensure unsubscribe on any exit path
      unsubscribe();
    });
  } catch (error) {
    console.error('ChatV2 stream error:', error);
    return toErrorResponse(error);
  }
});

export default chatV2;
