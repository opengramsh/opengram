import { validationError } from '@/src/api/http';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export type ChatListCursor = {
  pinned: number;
  lastMessageAt: number;
  id: string;
};

export type ParsedPagination = {
  limit: number;
  cursor: ChatListCursor | null;
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
