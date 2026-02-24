import type { SearchResponse } from '@/src/components/chats/types';

type SearchResultsListProps = {
  searchResults: SearchResponse | null;
  loading: boolean;
  query: string;
  onOpenChat: (chatId: string) => void;
};

export function SearchResultsList({ searchResults, loading, query, onOpenChat }: SearchResultsListProps) {
  if (loading) {
    return (
      <main className="flex-1 overflow-y-auto px-2 py-2">
        <p className="px-4 py-6 text-sm text-muted-foreground">Searching...</p>
      </main>
    );
  }

  if (!searchResults) {
    return (
      <main className="flex-1 overflow-y-auto px-2 py-2">
        <p className="px-4 py-6 text-sm text-muted-foreground">Type to search messages and chats.</p>
      </main>
    );
  }

  const hasChats = searchResults.chats.length > 0;
  const hasMessages = searchResults.messages.length > 0;
  const isEmpty = !hasChats && !hasMessages;

  return (
    <main className="flex-1 overflow-y-auto px-2 py-2">
      {isEmpty && (
        <p className="px-4 py-8 text-sm text-muted-foreground">
          No results for <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>
        </p>
      )}

      {hasChats && (
        <>
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Chats
          </p>
          {searchResults.chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              className="mb-2 w-full cursor-pointer rounded-2xl border border-border/80 bg-card px-3 py-3 text-left transition-colors hover:bg-muted/60"
              onClick={() => onOpenChat(chat.id)}
            >
              <p className="text-sm font-medium text-foreground">{chat.title}</p>
              {chat.snippet && (
                <p
                  className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/70 [&_mark]:rounded-sm [&_mark]:bg-yellow-300/30 [&_mark]:text-foreground"
                  dangerouslySetInnerHTML={{ __html: chat.snippet }}
                />
              )}
            </button>
          ))}
        </>
      )}

      {hasMessages && (
        <>
          <p className={`mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 ${hasChats ? 'mt-3' : ''}`}>
            Messages
          </p>
          {searchResults.messages.map((msg) => (
            <button
              key={msg.id}
              type="button"
              className="mb-2 w-full cursor-pointer rounded-2xl border border-border/80 bg-card px-3 py-3 text-left transition-colors hover:bg-muted/60"
              onClick={() => onOpenChat(msg.chat_id)}
            >
              <p className="text-[11px] font-semibold tracking-wide text-primary/60">{msg.chat_title}</p>
              <p
                className="mt-0.5 line-clamp-3 text-xs text-muted-foreground/80 [&_mark]:rounded-sm [&_mark]:bg-yellow-300/30 [&_mark]:text-foreground"
                dangerouslySetInnerHTML={{ __html: msg.snippet }}
              />
            </button>
          ))}
        </>
      )}
    </main>
  );
}
