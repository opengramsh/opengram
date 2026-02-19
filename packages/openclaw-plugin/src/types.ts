export type OpenClawConfig = {
  channels?: {
    opengram?: {
      name?: string;
      enabled?: boolean;
      baseUrl?: string;
      instanceSecret?: string;
      agents?: string[];
      defaultModelId?: string;
      reconnectDelayMs?: number;
    };
  };
};

export type Chat = {
  id: string;
  agentIds?: string[];
  [key: string]: unknown;
};

export type Message = {
  id: string;
  [key: string]: unknown;
};

export type Media = {
  id: string;
  [key: string]: unknown;
};

export type OGRequest = {
  id: string;
  [key: string]: unknown;
};

export type SearchResult = {
  chats: unknown[];
  messages: unknown[];
  [key: string]: unknown;
};

export type ListChatsResponse = {
  data: Chat[];
  cursor: {
    next?: string;
    hasMore: boolean;
  };
};
