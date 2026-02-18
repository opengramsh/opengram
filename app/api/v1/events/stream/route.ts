import { loadOpengramConfig } from '@/src/config/opengram-config';
import { toErrorResponse, unauthorizedError, validationError } from '@/src/api/http';
import {
  getLatestEventCursor,
  listEventsAfterCursor,
  subscribeToEvents,
  type EventEnvelope,
} from '@/src/services/events-service';

const encoder = new TextEncoder();

function toSseChunk(event: EventEnvelope) {
  const data = JSON.stringify(event);
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${data}\n\n`;
}

function requireStreamAuth(request: Request) {
  const config = loadOpengramConfig();
  if (!config.security.instanceSecretEnabled) {
    return;
  }

  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${config.security.instanceSecret}`;
  if (authHeader !== expected) {
    throw unauthorizedError('Missing or invalid instance secret.');
  }
}

function parseEphemeralParam(url: URL) {
  const value = url.searchParams.get('ephemeral');
  if (value === null || value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw validationError('ephemeral must be true or false.', { field: 'ephemeral' });
}

export async function GET(request: Request) {
  try {
    requireStreamAuth(request);
    const url = new URL(request.url);
    const cursorParam = url.searchParams.get('cursor');
    const cursor = cursorParam && cursorParam.trim() ? cursorParam.trim() : null;
    const ephemeral = parseEphemeralParam(url);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : 200;

    if (limitParam && Number.isNaN(limit)) {
      throw validationError('limit must be a number.', { field: 'limit' });
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw validationError('limit must be an integer between 1 and 200.', { field: 'limit' });
    }

    if (cursor !== null) {
      listEventsAfterCursor(cursor, 1);
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let replayCursor = cursor;
        const queuedLiveEvents: EventEnvelope[] = [];
        let replaying = true;
        const replayedPersistedIds = new Set<string>();

        const send = (value: string) => {
          if (closed) {
            return;
          }
          controller.enqueue(encoder.encode(value));
        };

        const unsubscribe = subscribeToEvents(ephemeral, (event) => {
          if (replaying) {
            queuedLiveEvents.push(event);
            return;
          }

          send(toSseChunk(event));
        });

        send(': stream opened\n\n');

        if (replayCursor === null) {
          replayCursor = getLatestEventCursor();
        }

        let replayBatchCursor = replayCursor;
        while (true) {
          const replayBatch = listEventsAfterCursor(replayBatchCursor, limit);
          for (const event of replayBatch) {
            send(toSseChunk(event));
            replayedPersistedIds.add(event.id);
          }

          if (replayBatch.length < limit) {
            break;
          }

          replayBatchCursor = replayBatch.at(-1)?.id ?? replayBatchCursor;
        }

        replaying = false;
        for (const event of queuedLiveEvents) {
          if (replayedPersistedIds.has(event.id)) {
            continue;
          }
          send(toSseChunk(event));
        }

        const keepAlive = setInterval(() => {
          try {
            send(': keepalive\n\n');
          } catch {
            clearInterval(keepAlive);
            unsubscribe();
            if (!closed) {
              controller.close();
              closed = true;
            }
          }
        }, 15_000);

        const close = () => {
          clearInterval(keepAlive);
          unsubscribe();
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
