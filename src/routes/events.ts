import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { toErrorResponse, validationError } from '@/src/api/http';
import { requireSseAuth } from '@/src/api/write-controls';
import {
  getEventRowidById,
  getLatestEventRowid,
  listEventsAfterRowid,
  subscribeToEvents,
  type EventEnvelope,
} from '@/src/services/events-service';

const MAX_QUEUED_LIVE_EVENTS_DURING_REPLAY = 512;

function parseEphemeralParam(url: URL) {
  const value = url.searchParams.get('ephemeral');
  if (value === null || value === 'true') return true;
  if (value === 'false') return false;
  throw validationError('ephemeral must be true or false.', { field: 'ephemeral' });
}

const events = new Hono();

events.get('/stream', (c) => {
  try {
    requireSseAuth(c.req.raw);
    const url = new URL(c.req.url);
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

    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');
    c.header('Content-Type', 'text/event-stream; charset=utf-8');

    return streamSSE(c, async (stream) => {
      let closed = false;
      let replayCursorRowid = cursorRowid;
      const queuedLiveEvents: EventEnvelope[] = [];
      let replaying = true;
      let replayQueueOverflowed = false;
      const replayHighWaterRowid = getLatestEventRowid();
      let keepAlive: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      let resolveClosedPromise: (() => void) | null = null;
      const closedPromise = new Promise<void>((resolve) => {
        resolveClosedPromise = resolve;
      });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        c.req.raw.signal.removeEventListener('abort', onAbortSignal);
        if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        resolveClosedPromise?.();
      };

      const onAbortSignal = () => {
        stream.abort();
        cleanup();
      };

      c.req.raw.signal.addEventListener('abort', onAbortSignal, { once: true });
      stream.onAbort(cleanup);

      if (c.req.raw.signal.aborted || stream.aborted) {
        cleanup();
        return;
      }

      const sendComment = async (value: string) => {
        if (closed || c.req.raw.signal.aborted || stream.aborted) {
          cleanup();
          return false;
        }

        try {
          await stream.write(value);
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      const sendEvent = async (event: EventEnvelope) => {
        if (closed || c.req.raw.signal.aborted || stream.aborted) {
          cleanup();
          return false;
        }

        try {
          await stream.writeSSE({
            id: event.id,
            event: event.type,
            data: JSON.stringify(event),
          });
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      unsubscribe = subscribeToEvents(ephemeral, (event) => {
        if (closed || c.req.raw.signal.aborted || stream.aborted) {
          cleanup();
          return;
        }

        if (replaying) {
          if (queuedLiveEvents.length >= MAX_QUEUED_LIVE_EVENTS_DURING_REPLAY) {
            replayQueueOverflowed = true;
            return;
          }
          queuedLiveEvents.push(event);
          return;
        }

        void sendEvent(event);
      });

      if (!(await sendComment(': stream opened\n\n'))) return;

      if (replayCursorRowid === null) {
        replayCursorRowid = replayHighWaterRowid;
      }

      let replayBatchCursorRowid = replayCursorRowid;
      while (true) {
        if (closed || c.req.raw.signal.aborted || stream.aborted) {
          cleanup();
          return;
        }

        const replayBatch = listEventsAfterRowid(replayBatchCursorRowid, limit, replayHighWaterRowid);
        for (const event of replayBatch) {
          if (!(await sendEvent(event))) return;
        }

        if (replayBatch.length < limit) break;
        replayBatchCursorRowid = replayBatch.at(-1)?.rowid ?? replayBatchCursorRowid;
      }

      replaying = false;
      if (replayQueueOverflowed) {
        await sendComment(': replay queue overflowed; reconnect required\n\n');
        cleanup();
        return;
      }

      for (const event of queuedLiveEvents) {
        if (closed || c.req.raw.signal.aborted || stream.aborted) {
          cleanup();
          return;
        }

        const rowid = getEventRowidById(event.id);
        if (rowid !== null && rowid <= replayHighWaterRowid) continue;
        if (!(await sendEvent(event))) return;
      }

      keepAlive = setInterval(() => {
        void sendComment(': keepalive\n\n');
      }, 15_000);

      await closedPromise;
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export default events;
