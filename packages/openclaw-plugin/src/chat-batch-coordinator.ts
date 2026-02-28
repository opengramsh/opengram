export type InboundBatchMessage = {
  chatId: string;
  messageId: string;
  content: string;
  traceKind?: string;
  mediaIds: string[];
  receivedAtMs: number;
};

type ChatBatchState = {
  pending: InboundBatchMessage[];
  active: boolean;
  firstPendingAtMs: number | null;
  lastUserTypingAtMs: number | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  typingGraceTimer: ReturnType<typeof setTimeout> | null;
  maxWaitTimer: ReturnType<typeof setTimeout> | null;
};

type LogLike = {
  info(msg: string): void;
  warn(msg: string): void;
};

const BATCH_DEBOUNCE_MS = 450;
const TYPING_GRACE_MS = 900;
const MAX_BATCH_WAIT_MS = 2_500;

export class ChatBatchCoordinator {
  private readonly chats = new Map<string, ChatBatchState>();

  constructor(
    private readonly onFlushBatch: (chatId: string, messages: InboundBatchMessage[]) => Promise<void>,
    private readonly log?: LogLike,
  ) {}

  enqueueMessage(msg: InboundBatchMessage): void {
    const state = this.getState(msg.chatId);
    state.pending.push(msg);

    if (state.firstPendingAtMs === null) {
      state.firstPendingAtMs = msg.receivedAtMs;
      state.maxWaitTimer = setTimeout(() => {
        this.tryFlush(msg.chatId, "max-wait");
      }, MAX_BATCH_WAIT_MS);
    }

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(() => {
      this.tryFlush(msg.chatId, "debounce");
    }, BATCH_DEBOUNCE_MS);

    this.scheduleTypingGrace(msg.chatId, state);
  }

  onUserTyping(chatId: string, atMs: number = Date.now()): void {
    const state = this.getState(chatId);
    state.lastUserTypingAtMs = atMs;
    this.scheduleTypingGrace(chatId, state);
  }

  resetForTests(): void {
    for (const [chatId, state] of this.chats) {
      this.clearTimers(chatId, state);
    }
    this.chats.clear();
  }

  private getState(chatId: string): ChatBatchState {
    const existing = this.chats.get(chatId);
    if (existing) {
      return existing;
    }

    const created: ChatBatchState = {
      pending: [],
      active: false,
      firstPendingAtMs: null,
      lastUserTypingAtMs: null,
      debounceTimer: null,
      typingGraceTimer: null,
      maxWaitTimer: null,
    };
    this.chats.set(chatId, created);
    return created;
  }

  private scheduleTypingGrace(chatId: string, state: ChatBatchState): void {
    if (state.pending.length === 0 || state.lastUserTypingAtMs === null) {
      return;
    }

    const age = Date.now() - state.lastUserTypingAtMs;
    const waitMs = age >= TYPING_GRACE_MS ? 0 : TYPING_GRACE_MS - age;

    if (state.typingGraceTimer) {
      clearTimeout(state.typingGraceTimer);
    }

    state.typingGraceTimer = setTimeout(() => {
      this.tryFlush(chatId, "typing-grace");
    }, waitMs);
  }

  private tryFlush(chatId: string, reason: "debounce" | "typing-grace" | "max-wait" | "drain"): void {
    const state = this.chats.get(chatId);
    if (!state || state.active || state.pending.length === 0) {
      return;
    }

    if (reason !== "max-wait" && state.lastUserTypingAtMs !== null) {
      const age = Date.now() - state.lastUserTypingAtMs;
      if (age < TYPING_GRACE_MS) {
        this.scheduleTypingGrace(chatId, state);
        return;
      }
    }

    const batch = state.pending.splice(0, state.pending.length);
    this.clearTimers(chatId, state);

    state.active = true;
    void this.onFlushBatch(chatId, batch)
      .catch((err) => {
        this.log?.warn(`[chat-batch] flush failed for chat ${chatId}: ${String(err)}`);
      })
      .finally(() => {
        const current = this.chats.get(chatId);
        if (!current) {
          return;
        }

        current.active = false;
        if (current.pending.length === 0) {
          current.firstPendingAtMs = null;
          return;
        }

        if (current.firstPendingAtMs === null) {
          current.firstPendingAtMs = current.pending[0]?.receivedAtMs ?? Date.now();
          current.maxWaitTimer = setTimeout(() => {
            this.tryFlush(chatId, "max-wait");
          }, MAX_BATCH_WAIT_MS);
        }

        this.log?.info(`[chat-batch] draining pending queue for chat ${chatId} (${current.pending.length} pending)`);
        this.tryFlush(chatId, "drain");
      });
  }

  private clearTimers(chatId: string, state: ChatBatchState): void {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    if (state.typingGraceTimer) {
      clearTimeout(state.typingGraceTimer);
      state.typingGraceTimer = null;
    }
    if (state.maxWaitTimer) {
      clearTimeout(state.maxWaitTimer);
      state.maxWaitTimer = null;
    }

    if (state.pending.length === 0 && !state.active) {
      this.chats.delete(chatId);
    }
  }
}
