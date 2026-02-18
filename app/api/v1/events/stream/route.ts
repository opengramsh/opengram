import { toErrorResponse, validationError } from '@/src/api/http';
import { getLatestEventCursor, listEventsAfterCursor } from '@/src/services/events-service';

const encoder = new TextEncoder();

function toSseChunk(event: { id: string; type: string; timestamp: string; payload: Record<string, unknown> }) {
  const data = JSON.stringify(event);
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${data}\n\n`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cursorParam = url.searchParams.get('cursor');
    const cursor = cursorParam && cursorParam.trim() ? cursorParam.trim() : null;
    const ephemeral = url.searchParams.get('ephemeral') !== 'false';
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : 100;

    if (limitParam && Number.isNaN(limit)) {
      throw validationError('limit must be a number.', { field: 'limit' });
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let currentCursor = cursor ?? getLatestEventCursor();

        const send = (value: string) => {
          if (closed) {
            return;
          }
          controller.enqueue(encoder.encode(value));
        };

        const flush = () => {
          const events = listEventsAfterCursor(currentCursor, limit);
          for (const event of events) {
            if (!ephemeral && event.type === 'message.streaming.chunk') {
              continue;
            }

            send(toSseChunk(event));
            currentCursor = event.id;
          }
        };

        send(': stream opened\n\n');
        flush();

        const poll = setInterval(() => {
          try {
            flush();
            send(': keepalive\n\n');
          } catch {
            clearInterval(poll);
            if (!closed) {
              controller.close();
              closed = true;
            }
          }
        }, 1000);

        const close = () => {
          clearInterval(poll);
          if (!closed) {
            controller.close();
            closed = true;
          }
        };

        request.signal.addEventListener('abort', close);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
