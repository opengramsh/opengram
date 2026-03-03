export type InboundBatchMessage = {
    chatId: string;
    messageId: string;
    content: string;
    traceKind?: string;
    mediaIds: string[];
    receivedAtMs: number;
};
type LogLike = {
    info(msg: string): void;
    warn(msg: string): void;
};
export declare class ChatBatchCoordinator {
    private readonly onFlushBatch;
    private readonly log?;
    private readonly chats;
    constructor(onFlushBatch: (chatId: string, messages: InboundBatchMessage[]) => Promise<void>, log?: LogLike | undefined);
    enqueueMessage(msg: InboundBatchMessage): void;
    onUserTyping(chatId: string, atMs?: number): void;
    resetForTests(): void;
    private getState;
    private scheduleTypingGrace;
    private tryFlush;
    private clearTimers;
}
export {};
