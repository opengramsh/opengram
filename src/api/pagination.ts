import { validationError } from '@/src/api/http';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_MESSAGE_LIMIT = 200;

export type ChatListCursor = {
  pinned: number;
  lastMessageAt: number;
  id: string;
};

export type ParsedPagination = {
  limit: number;
  cursor: ChatListCursor | null;
};

export type MessageListCursor = {
  createdAt: number;
  id: string;
};

export type ParsedMessagePagination = {
  limit: number;
  cursor: MessageListCursor | null;
};

export type SearchCursor = {
  sortAt: number;
  resultType: 'chat' | 'message';
  id: string;
};

export type ParsedSearchPagination = {
  limit: number;
  cursor: SearchCursor | null;
};

export type MediaListCursor = {
  createdAt: number;
  id: string;
};

export type ParsedMediaPagination = {
  limit: number;
  cursor: MediaListCursor | null;
};

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function encodeCursor(payload: ChatListCursor) {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeCursor(rawCursor: string): ChatListCursor {
  try {
    const parsed = JSON.parse(fromBase64Url(rawCursor)) as Partial<ChatListCursor>;
    if (
      typeof parsed.pinned !== 'number'
      || typeof parsed.lastMessageAt !== 'number'
      || typeof parsed.id !== 'string'
    ) {
      throw new Error('Invalid cursor payload.');
    }

    return {
      pinned: parsed.pinned,
      lastMessageAt: parsed.lastMessageAt,
      id: parsed.id,
    };
  } catch {
    throw validationError('Invalid cursor value.', { field: 'cursor' });
  }
}

export function encodeMessageCursor(payload: MessageListCursor) {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeMessageCursor(rawCursor: string): MessageListCursor {
  try {
    const parsed = JSON.parse(fromBase64Url(rawCursor)) as Partial<MessageListCursor>;
    if (typeof parsed.createdAt !== 'number' || typeof parsed.id !== 'string') {
      throw new Error('Invalid cursor payload.');
    }

    return {
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch {
    throw validationError('Invalid cursor value.', { field: 'cursor' });
  }
}

export function parsePagination(params: URLSearchParams): ParsedPagination {
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);

  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw validationError('limit must be an integer between 1 and 100.', { field: 'limit' });
  }

  const rawCursor = params.get('cursor');
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;

  return {
    limit,
    cursor,
  };
}

export function parseMessagePagination(params: URLSearchParams): ParsedMessagePagination {
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);

  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_MESSAGE_LIMIT) {
    throw validationError('limit must be an integer between 1 and 200.', { field: 'limit' });
  }

  const rawCursor = params.get('cursor');
  const cursor = rawCursor ? decodeMessageCursor(rawCursor) : null;

  return {
    limit,
    cursor,
  };
}

export function encodeSearchCursor(payload: SearchCursor) {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeSearchCursor(rawCursor: string): SearchCursor {
  try {
    const parsed = JSON.parse(fromBase64Url(rawCursor)) as Partial<SearchCursor>;
    if (
      typeof parsed.sortAt !== 'number'
      || typeof parsed.id !== 'string'
      || (parsed.resultType !== 'chat' && parsed.resultType !== 'message')
    ) {
      throw new Error('Invalid cursor payload.');
    }

    return {
      sortAt: parsed.sortAt,
      resultType: parsed.resultType,
      id: parsed.id,
    };
  } catch {
    throw validationError('Invalid cursor value.', { field: 'cursor' });
  }
}

export function parseSearchPagination(params: URLSearchParams): ParsedSearchPagination {
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);

  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw validationError('limit must be an integer between 1 and 100.', { field: 'limit' });
  }

  const rawCursor = params.get('cursor');
  const cursor = rawCursor ? decodeSearchCursor(rawCursor) : null;

  return {
    limit,
    cursor,
  };
}

export function encodeMediaCursor(payload: MediaListCursor) {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeMediaCursor(rawCursor: string): MediaListCursor {
  try {
    const parsed = JSON.parse(fromBase64Url(rawCursor)) as Partial<MediaListCursor>;
    if (typeof parsed.createdAt !== 'number' || typeof parsed.id !== 'string') {
      throw new Error('Invalid cursor payload.');
    }

    return {
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch {
    throw validationError('Invalid cursor value.', { field: 'cursor' });
  }
}

export function parseMediaPagination(params: URLSearchParams): ParsedMediaPagination {
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);

  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw validationError('limit must be an integer between 1 and 100.', { field: 'limit' });
  }

  const rawCursor = params.get('cursor');
  const cursor = rawCursor ? decodeMediaCursor(rawCursor) : null;

  return {
    limit,
    cursor,
  };
}
