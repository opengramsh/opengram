const BATCH_DEBOUNCE_MS = 450;
const TYPING_GRACE_MS = 900;
const MAX_BATCH_WAIT_MS = 2_500;
export class ChatBatchCoordinator {
    onFlushBatch;
    log;
    chats = new Map();
    constructor(onFlushBatch, log) {
        this.onFlushBatch = onFlushBatch;
        this.log = log;
    }
    enqueueMessage(msg) {
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
    onUserTyping(chatId, atMs = Date.now()) {
        const state = this.getState(chatId);
        state.lastUserTypingAtMs = atMs;
        this.scheduleTypingGrace(chatId, state);
    }
    resetForTests() {
        for (const [chatId, state] of this.chats) {
            this.clearTimers(chatId, state);
        }
        this.chats.clear();
    }
    getState(chatId) {
        const existing = this.chats.get(chatId);
        if (existing) {
            return existing;
        }
        const created = {
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
    scheduleTypingGrace(chatId, state) {
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
    tryFlush(chatId, reason) {
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
    clearTimers(chatId, state) {
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
