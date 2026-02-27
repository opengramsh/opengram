import { useCallback, useMemo, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

import { prepareSendMessagesRequest } from '../_lib/prepare-send-request';

type UseChatV2SendArgs = {
  chatId: string;
  pendingAttachmentIds: string[];
  onSendStart: () => void;
  onSendComplete: () => void;
  onSendError: () => void;
  clearAttachments: () => void;
};

export function useChatV2Send({ chatId, pendingAttachmentIds, onSendStart, onSendComplete, onSendError, clearAttachments }: UseChatV2SendArgs) {
  // Ref so prepareSendMessagesRequest always sees the latest IDs without
  // recreating the transport (which would reset useChat state).
  const attachmentIdsRef = useRef<string[]>(pendingAttachmentIds);
  attachmentIdsRef.current = pendingAttachmentIds;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/v2/chats/${chatId}/stream`,
        prepareSendMessagesRequest: ({ messages }) =>
          prepareSendMessagesRequest(messages, attachmentIdsRef.current),
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
      onSendError();
    }
  }, [sendMessage, pendingAttachmentIds, onSendStart, onSendComplete, onSendError, clearAttachments]);

  return {
    send,
    status,
    stop,
    isStreaming: status === 'submitted' || status === 'streaming',
  };
}

export type ChatV2SendReturn = ReturnType<typeof useChatV2Send>;
