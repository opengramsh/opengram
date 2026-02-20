export type ChatFeedMessage = {
  id: string;
  created_at: string | null;
};

export type RealtimeMessage = ChatFeedMessage & {
  role: 'user' | 'agent' | 'system' | 'tool';
  sender_id: string;
  content_final: string | null;
  content_partial: string | null;
  stream_state: 'none' | 'streaming' | 'complete' | 'cancelled';
  trace?: Record<string, unknown> | null;
};

export type EdgeSwipeResolution = {
  shouldNavigateBack: boolean;
  velocity: number;
};

const DEFAULT_EDGE_WIDTH_PX = 20;
const DEFAULT_BACK_THRESHOLD_PX = 60;

function parseTimestamp(value: string | null) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function sortMessagesForFeed<T extends ChatFeedMessage>(messages: T[]): T[] {
  return [...messages].sort((left, right) => {
    const leftAt = parseTimestamp(left.created_at);
    const rightAt = parseTimestamp(right.created_at);

    if (leftAt !== rightAt) {
      return leftAt - rightAt;
    }

    return left.id.localeCompare(right.id);
  });
}

export function shouldStartEdgeSwipeBack(startX: number, edgeWidthPx = DEFAULT_EDGE_WIDTH_PX): boolean {
  return startX >= 0 && startX <= edgeWidthPx;
}

export function resolveEdgeSwipeBack(
  deltaX: number,
  deltaY: number,
  elapsedMs: number,
  thresholdPx = DEFAULT_BACK_THRESHOLD_PX,
): EdgeSwipeResolution {
  const velocity = elapsedMs > 0 ? deltaX / elapsedMs : 0;
  const horizontalDominant = Math.abs(deltaX) > Math.abs(deltaY);

  return {
    shouldNavigateBack: horizontalDominant && deltaX >= thresholdPx,
    velocity,
  };
}

export function upsertFeedMessage<T extends ChatFeedMessage>(messages: T[], incoming: T): T[] {
  const next = messages.filter((message) => message.id !== incoming.id);
  next.push(incoming);
  return sortMessagesForFeed(next);
}

export function applyStreamingChunk<T extends RealtimeMessage>(
  messages: T[],
  messageId: string,
  deltaText: string,
): T[] {
  let updated = false;

  const next = messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    updated = true;
    const partial = `${message.content_partial ?? ''}${deltaText}`;
    return {
      ...message,
      content_partial: partial,
      stream_state: 'streaming',
    };
  });

  return updated ? next : messages;
}

export function applyStreamingComplete<T extends RealtimeMessage>(
  messages: T[],
  messageId: string,
  finalText?: string,
  streamState: 'complete' | 'cancelled' = 'complete',
): T[] {
  let updated = false;
  const next = messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    updated = true;
    if (streamState === 'cancelled') {
      return {
        ...message,
        stream_state: 'cancelled',
      };
    }

    const contentFinal = finalText ?? message.content_partial ?? message.content_final;
    return {
      ...message,
      content_final: contentFinal,
      content_partial: null,
      stream_state: 'complete',
    };
  });

  return updated ? next : messages;
}
