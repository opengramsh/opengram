import type Database from 'better-sqlite3';

import { validationError } from '@/src/api/http';
import { encodeSearchCursor, parseSearchPagination, type SearchCursor } from '@/src/api/pagination';
import { createSqliteConnection } from '@/src/db/client';

type SearchScope = 'all' | 'titles' | 'messages';
type ResultType = 'chat' | 'message';

type ChatSearchRow = {
  id: string;
  title: string;
  sort_at: number;
};

type MessageSearchRow = {
  id: string;
  chat_id: string;
  chat_title: string;
  sort_at: number;
  snippet: string;
};

type CombinedSearchRow =
  | {
      resultType: 'chat';
      id: string;
      sortAt: number;
      chat: {
        id: string;
        title: string;
        snippet: string;
      };
    }
  | {
      resultType: 'message';
      id: string;
      sortAt: number;
      message: {
        id: string;
        chat_id: string;
        chat_title: string;
        snippet: string;
      };
    };

type SearchResult = {
  chats: Array<{
    id: string;
    title: string;
    snippet: string;
  }>;
  messages: Array<{
    id: string;
    chat_id: string;
    chat_title: string;
    snippet: string;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
};

const SEARCH_HIGHLIGHT_OPEN = '__opengram_search_mark_open__';
const SEARCH_HIGHLIGHT_CLOSE = '__opengram_search_mark_close__';

function withDb<T>(callback: (db: Database.Database) => T): T {
  const db = createSqliteConnection();
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function normalizeScope(value: string | null): SearchScope {
  if (value === null || value === '') {
    return 'titles';
  }

  if (value === 'all' || value === 'titles' || value === 'messages') {
    return value;
  }

  throw validationError('scope must be one of all, titles, messages.', { field: 'scope' });
}

function normalizeQuery(value: string | null): string {
  if (value === null) {
    throw validationError('q is required.', { field: 'q' });
  }

  const query = value.trim();
  if (!query) {
    throw validationError('q cannot be empty.', { field: 'q' });
  }

  return query;
}

function escapeLikeQuery(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeHighlightedSnippet(value: string) {
  return escapeHtml(value)
    .replaceAll(SEARCH_HIGHLIGHT_OPEN, '<mark>')
    .replaceAll(SEARCH_HIGHLIGHT_CLOSE, '</mark>');
}

function resultTypeRank(resultType: ResultType) {
  return resultType === 'message' ? 1 : 0;
}

function compareResults(a: CombinedSearchRow, b: CombinedSearchRow) {
  if (a.sortAt !== b.sortAt) {
    return b.sortAt - a.sortAt;
  }

  const rankDiff = resultTypeRank(b.resultType) - resultTypeRank(a.resultType);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  return b.id.localeCompare(a.id);
}

function buildCursorClause(
  cursor: SearchCursor | null,
  type: ResultType,
  sortColumn: string,
  idColumn: string,
) {
  if (!cursor) {
    return { clause: '', values: [] as unknown[] };
  }

  const cursorRank = resultTypeRank(cursor.resultType);
  const thisRank = resultTypeRank(type);

  if (thisRank > cursorRank) {
    return {
      clause: `AND ${sortColumn} < ?`,
      values: [cursor.sortAt],
    };
  }

  if (thisRank < cursorRank) {
    return {
      clause: `AND ${sortColumn} <= ?`,
      values: [cursor.sortAt],
    };
  }

  return {
    clause: `AND (${sortColumn} < ? OR (${sortColumn} = ? AND ${idColumn} < ?))`,
    values: [cursor.sortAt, cursor.sortAt, cursor.id],
  };
}

function queryTitleMatches(
  db: Database.Database,
  query: string,
  limit: number,
  cursor: SearchCursor | null,
) {
  const likeQuery = `%${escapeLikeQuery(query)}%`;
  const cursorClause = buildCursorClause(
    cursor,
    'chat',
    'COALESCE(last_message_at, updated_at, created_at)',
    'id',
  );

  const rows = db
    .prepare(
      [
        'SELECT id, title, COALESCE(last_message_at, updated_at, created_at) AS sort_at',
        'FROM chats',
        'WHERE title LIKE ? ESCAPE \'\\\'',
        cursorClause.clause,
        'ORDER BY sort_at DESC, id DESC',
        'LIMIT ?',
      ].join(' '),
    )
    .all(likeQuery, ...cursorClause.values, limit + 1) as ChatSearchRow[];

  return rows.map((row) => ({
    resultType: 'chat' as const,
    id: row.id,
    sortAt: row.sort_at,
    chat: {
      id: row.id,
      title: row.title,
      snippet: row.title,
    },
  }));
}

function queryMessageMatches(
  db: Database.Database,
  query: string,
  limit: number,
  cursor: SearchCursor | null,
) {
  const cursorClause = buildCursorClause(cursor, 'message', 'm.created_at', 'm.id');

  const isInvalidMatchQueryError = (error: unknown) => {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('fts5: syntax error')
      || message.includes('malformed match')
      || message.includes('unterminated string')
    );
  };

  try {
    const rows = db
      .prepare(
        [
          'SELECT',
          'm.id,',
          'm.chat_id,',
          'c.title AS chat_title,',
          'm.created_at AS sort_at,',
          'snippet(messages_fts, 2, ?, ?, \'…\', 20) AS snippet',
          'FROM messages_fts',
          'JOIN messages m ON m.id = messages_fts.message_id',
          'JOIN chats c ON c.id = m.chat_id',
          'WHERE messages_fts MATCH ?',
          cursorClause.clause,
          'ORDER BY m.created_at DESC, m.id DESC',
          'LIMIT ?',
        ].join(' '),
      )
      .all(
        SEARCH_HIGHLIGHT_OPEN,
        SEARCH_HIGHLIGHT_CLOSE,
        query,
        ...cursorClause.values,
        limit + 1,
      ) as MessageSearchRow[];

    return rows.map((row) => ({
      resultType: 'message' as const,
      id: row.id,
      sortAt: row.sort_at,
      message: {
        id: row.id,
        chat_id: row.chat_id,
        chat_title: row.chat_title,
        snippet: sanitizeHighlightedSnippet(row.snippet),
      },
    }));
  } catch (error) {
    if (isInvalidMatchQueryError(error)) {
      throw validationError('Invalid full-text search query.', { field: 'q' });
    }

    throw error;
  }
}

export function search(url: URL): SearchResult {
  const scope = normalizeScope(url.searchParams.get('scope'));
  const query = normalizeQuery(url.searchParams.get('q'));
  const { limit, cursor } = parseSearchPagination(url.searchParams);

  return withDb((db) => {
    const candidates: CombinedSearchRow[] = [];

    if (scope === 'all' || scope === 'titles') {
      candidates.push(...queryTitleMatches(db, query, limit, cursor));
    }

    if (scope === 'all' || scope === 'messages') {
      candidates.push(...queryMessageMatches(db, query, limit, cursor));
    }

    candidates.sort(compareResults);

    const hasMore = candidates.length > limit;
    const page = hasMore ? candidates.slice(0, limit) : candidates;
    const last = page.at(-1);

    const nextCursor = hasMore && last
      ? encodeSearchCursor({
          sortAt: last.sortAt,
          resultType: last.resultType,
          id: last.id,
        })
      : null;

    return {
      chats: page.filter((item) => item.resultType === 'chat').map((item) => item.chat),
      messages: page.filter((item) => item.resultType === 'message').map((item) => item.message),
      nextCursor,
      hasMore,
    };
  });
}
