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

function sseChunk(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// POST /api/v2/chats/:chatId/stream
// Bridges our async SSE model → AI SDK v6 UIMessage stream protocol
chatV2.post('/:chatId/stream', async (c) => {
  try {
    applyWriteMiddlewares(c.req.raw);
    const chatId = c.req.param('chatId');

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

    // Create user message
    const userMessage = createMessage(chatId, {
      role: 'user',
      senderId: 'user:primary',
      content: body.message?.trim() || '',
      streaming: false,
      modelId: body.modelId,
      ...(body.attachmentIds?.length
        ? { trace: { mediaIds: body.attachmentIds } }
        : {}),
    });

    // Set AI SDK v6 UIMessage stream SSE headers
    c.header('Content-Type', 'text/event-stream; charset=utf-8');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Vercel-AI-UI-Message-Stream', 'v1');
    c.header('X-Accel-Buffering', 'no');

    return stream(c, async (s) => {
      let agentMessageId: string | null = null;
      let completed = false;
      let timedOut = false;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
      }, TIMEOUT_MS);

      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timeoutHandle);
          resolve();
        };

        const unsubscribe = subscribeToEvents(true, (event: EventEnvelope) => {
          if (completed || timedOut) {
            unsubscribe();
            finish();
            return;
          }

          const payload = event.payload;

          // Watch for agent message creation in this chat
          if (event.type === 'message.created' && payload.chatId === chatId) {
            if (payload.role === 'agent' && payload.streamState === 'streaming') {
              agentMessageId = payload.messageId as string;
              // Emit start + start-step + text-start
              void s.write(sseChunk({ type: 'start' }));
              void s.write(sseChunk({ type: 'start-step' }));
              void s.write(sseChunk({ type: 'text-start', id: TEXT_PART_ID }));
            }

            // Non-streaming agent message (already complete)
            if (
              payload.role === 'agent' &&
              payload.streamState !== 'streaming'
            ) {
              const content = (payload.contentFinal as string) || '';
              completed = true;
              void s.write(sseChunk({ type: 'start' }));
              void s.write(sseChunk({ type: 'start-step' }));
              void s.write(sseChunk({ type: 'text-start', id: TEXT_PART_ID }));
              if (content) {
                void s.write(sseChunk({ type: 'text-delta', delta: content, id: TEXT_PART_ID }));
              }
              void s.write(sseChunk({ type: 'text-end', id: TEXT_PART_ID }));
              void s.write(sseChunk({ type: 'finish-step' }));
              void s.write(sseChunk({ type: 'finish', finishReason: 'stop' }));
              void s.write('data: [DONE]\n\n');
              unsubscribe();
              finish();
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
            void s.write(sseChunk({ type: 'text-end', id: TEXT_PART_ID }));
            void s.write(sseChunk({ type: 'finish-step' }));
            void s.write(sseChunk({ type: 'finish', finishReason: 'stop' }));
            void s.write('data: [DONE]\n\n');
            unsubscribe();
            finish();
          }
        });

        // Handle timeout
        const checkTimeout = setInterval(() => {
          if (timedOut) {
            clearInterval(checkTimeout);
            if (!completed) {
              completed = true;
              // If we started a text stream, close it
              if (agentMessageId) {
                void s.write(sseChunk({ type: 'text-end', id: TEXT_PART_ID }));
                void s.write(sseChunk({ type: 'finish-step' }));
              }
              void s.write(sseChunk({ type: 'finish', finishReason: 'error' }));
              void s.write('data: [DONE]\n\n');
              unsubscribe();
              finish();
            }
          }
        }, 1000);

        // Handle client disconnect
        c.req.raw.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeoutHandle);
            clearInterval(checkTimeout);
            unsubscribe();
            resolve();
          },
          { once: true },
        );
      });
    });
  } catch (error) {
    console.error('ChatV2 stream error:', error);
    return toErrorResponse(error);
  }
});

export default chatV2;
