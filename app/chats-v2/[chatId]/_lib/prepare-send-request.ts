import { getApiSecret } from '@/src/lib/api-fetch';

type MessagePart = { type: string; text?: string };
type PrepareMessage = { parts?: MessagePart[] };

/**
 * Builds the request body and headers for the AI SDK DefaultChatTransport.
 * Extracted so both the hook and tests can share the same implementation.
 */
export function prepareSendMessagesRequest(
  messages: PrepareMessage[],
  attachmentIds: string[],
) {
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
    body: { message: text, attachmentIds },
    headers,
  };
}
