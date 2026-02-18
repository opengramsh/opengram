export type ChatFeedMessage = {
  id: string;
  created_at: string | null;
};

export type EdgeSwipeResolution = {
  shouldNavigateBack: boolean;
  velocity: number;
};

const DEFAULT_EDGE_WIDTH_PX = 20;
const DEFAULT_BACK_THRESHOLD_PX = 60;
const DEFAULT_MIN_VELOCITY_PX_PER_MS = 0.15;

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
  minVelocityPxPerMs = DEFAULT_MIN_VELOCITY_PX_PER_MS,
): EdgeSwipeResolution {
  const velocity = elapsedMs > 0 ? deltaX / elapsedMs : 0;
  const horizontalDominant = Math.abs(deltaX) > Math.abs(deltaY);

  return {
    shouldNavigateBack: horizontalDominant && deltaX >= thresholdPx && velocity > minVelocityPxPerMs,
    velocity,
  };
}
