import { loadOpengramConfig } from '@/src/config/opengram-config';
import { toErrorResponse, unauthorizedError, validationError } from '@/src/api/http';
import {
  getEventRowidById,
  getLatestEventRowid,
  listEventsAfterRowid,
  subscribeToEvents,
  type EventEnvelope,
} from '@/src/services/events-service';

const encoder = new TextEncoder();
const MAX_QUEUED_LIVE_EVENTS_DURING_REPLAY = 512;

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

    const cursorRowid = cursor === null ? null : getEventRowidById(cursor);
    if (cursor !== null && cursorRowid === null) {
      throw validationError('cursor event id was not found.', { field: 'cursor' });
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let replayCursorRowid = cursorRowid;
        const queuedLiveEvents: EventEnvelope[] = [];
        let replaying = true;
        let replayQueueOverflowed = false;
        const replayHighWaterRowid = getLatestEventRowid();
        let keepAlive: ReturnType<typeof setInterval> | null = null;
        let unsubscribe: (() => void) | null = null;

        const send = (value: string) => {
          if (closed) {
            return;
          }
          controller.enqueue(encoder.encode(value));
        };

        const close = () => {
          if (keepAlive) {
            clearInterval(keepAlive);
          }
          if (unsubscribe) {
            unsubscribe();
          }
          if (!closed) {
            controller.close();
            closed = true;
          }
        };

        unsubscribe = subscribeToEvents(ephemeral, (event) => {
          if (replaying) {
            if (queuedLiveEvents.length >= MAX_QUEUED_LIVE_EVENTS_DURING_REPLAY) {
              replayQueueOverflowed = true;
              return;
            }
            queuedLiveEvents.push(event);
            return;
          }

          send(toSseChunk(event));
        });

        send(': stream opened\n\n');

        if (replayCursorRowid === null) {
          replayCursorRowid = replayHighWaterRowid;
        }

        let replayBatchCursorRowid = replayCursorRowid;
        while (true) {
          const replayBatch = listEventsAfterRowid(replayBatchCursorRowid, limit, replayHighWaterRowid);
          for (const event of replayBatch) {
            send(toSseChunk(event));
          }

          if (replayBatch.length < limit) {
            break;
          }

          replayBatchCursorRowid = replayBatch.at(-1)?.rowid ?? replayBatchCursorRowid;
        }

        replaying = false;
        if (replayQueueOverflowed) {
          send(': replay queue overflowed; reconnect required\n\n');
          close();
          return;
        }

        for (const event of queuedLiveEvents) {
          const rowid = getEventRowidById(event.id);
          if (rowid !== null && rowid <= replayHighWaterRowid) {
            continue;
          }
          send(toSseChunk(event));
        }

        keepAlive = setInterval(() => {
          try {
            send(': keepalive\n\n');
          } catch {
            close();
          }
        }, 15_000);

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
