const MS_IN_DAY = 24 * 60 * 60 * 1000;

type TimestampInput = string | number | Date | null | undefined;

export type InboxQueryInput = {
  archived?: boolean;
  query?: string;
  agentId?: string | null;
  state?: string | null;
  limit?: number;
};

export type InboxSortableChat = {
  id: string;
  pinned: boolean;
  last_message_at: string | null;
};

export type InboxSwipeEndState = {
  nextOffset: number;
  shouldArchive: boolean;
};

function parseTimestamp(value: TimestampInput): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatInboxTimestamp(value: TimestampInput, nowInput: Date = new Date()): string {
  const date = parseTimestamp(value);
  if (!date) {
    return '';
  }

  const now = parseTimestamp(nowInput) ?? new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((startOfToday.getTime() - startOfDate.getTime()) / MS_IN_DAY);

  if (diffDays === 0) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  if (diffDays === 1) {
    return 'Yesterday';
  }

  if (diffDays > 1 && diffDays < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(date);
}

export function buildChatsQuery(input: InboxQueryInput): string {
  const params = new URLSearchParams();
  params.set('archived', input.archived ? 'true' : 'false');

  if (input.query?.trim()) {
    params.set('query', input.query.trim());
  }

  if (input.agentId) {
    params.set('agentId', input.agentId);
  }

  if (input.state) {
    params.set('state', input.state);
  }

  if (typeof input.limit === 'number') {
    params.set('limit', String(input.limit));
  }

  return `?${params.toString()}`;
}

export function getPendingRequestsTotal(
  chats: Array<{ pending_requests_count: number | null | undefined }>,
): number {
  return chats.reduce((total, chat) => total + Math.max(0, chat.pending_requests_count ?? 0), 0);
}

export function sortInboxChats<T extends InboxSortableChat>(chats: T[]): T[] {
  return [...chats].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }

    const leftAt = left.last_message_at ? new Date(left.last_message_at).getTime() : 0;
    const rightAt = right.last_message_at ? new Date(right.last_message_at).getTime() : 0;
    if (leftAt !== rightAt) {
      return rightAt - leftAt;
    }

    return right.id.localeCompare(left.id);
  });
}

export function shouldStartInboxSwipeDrag(deltaX: number, deltaY: number, baseOffsetX: number): boolean {
  const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) + 6;
  if (!isHorizontal) {
    return false;
  }

  if (deltaX > 0 && baseOffsetX >= 0) {
    return false;
  }

  return true;
}

export function resolveInboxSwipeEnd(offsetX: number, isDragging: boolean): InboxSwipeEndState {
  if (!isDragging) {
    return {
      nextOffset: offsetX < 0 ? 0 : offsetX,
      shouldArchive: false,
    };
  }

  if (offsetX <= -170) {
    return { nextOffset: 0, shouldArchive: true };
  }

  if (offsetX <= -46) {
    return { nextOffset: -86, shouldArchive: false };
  }

  return { nextOffset: 0, shouldArchive: false };
}
