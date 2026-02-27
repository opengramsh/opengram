import { useCallback, useMemo, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

import { getApiSecret } from '@/src/lib/api-fetch';

type UseChatV2SendArgs = {
  chatId: string;
  pendingAttachmentIds: string[];
  onSendStart: () => void;
  onSendComplete: () => void;
  clearAttachments: () => void;
};

export function useChatV2Send({ chatId, pendingAttachmentIds, onSendStart, onSendComplete, clearAttachments }: UseChatV2SendArgs) {
  // Ref so prepareSendMessagesRequest always sees the latest IDs without
  // recreating the transport (which would reset useChat state).
  const attachmentIdsRef = useRef<string[]>(pendingAttachmentIds);
  attachmentIdsRef.current = pendingAttachmentIds;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/v2/chats/${chatId}/stream`,
        prepareSendMessagesRequest: ({ messages }) => {
          // Extract text from the last user message's parts
          const lastMsg = messages[messages.length - 1];
          const text =
            lastMsg?.parts
              ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('') ?? '';

          const headers: Record<string, string> = { 'content-type': 'application/json' };
          const secret = getApiSecret();
          if (secret) headers['authorization'] = `Bearer ${secret}`;

          return {
            body: {
              message: text,
              attachmentIds: attachmentIdsRef.current,
            },
            headers,
          };
        },
      }),
    [chatId],
  );

  const { sendMessage, status, stop } = useChat({ transport });

  const send = useCallback(async (text: string) => {
    if (!text.trim() && pendingAttachmentIds.length === 0) return;
    onSendStart();
    clearAttachments();
    try {
      await sendMessage({ text });
      onSendComplete();
    } catch {
      // Send errors are non-fatal; SSE will still deliver the message
    }
  }, [sendMessage, pendingAttachmentIds, onSendStart, onSendComplete, clearAttachments]);

  return {
    send,
    status,
    stop,
    isStreaming: status === 'submitted' || status === 'streaming',
  };
}

export type ChatV2SendReturn = ReturnType<typeof useChatV2Send>;
