export type Agent = {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
  defaultModelId?: string;
};

export type Model = {
  id: string;
  name: string;
  description: string;
};

export type ConfigResponse = {
  appName: string;
  agents: Agent[];
  models: Model[];
  defaultModelIdForNewChats: string;
  security?: {
    instanceSecretEnabled?: boolean;
    readEndpointsRequireInstanceSecret?: boolean;
  };
};

export type Chat = {
  id: string;
  is_archived: boolean;
  title: string;
  title_source: 'default' | 'auto' | 'manual';
  tags: string[];
  pinned: boolean;
  agent_ids: string[];
  model_id: string;
  last_message_preview: string | null;
  last_message_role: string | null;
  pending_requests_count: number;
  last_read_at: string | null;
  unread_count: number;
  notifications_muted?: boolean;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

export type ChatsResponse = {
  data: Chat[];
  cursor: {
    next: string | null;
    hasMore: boolean;
  };
};

export type SearchChatResult = { id: string; title: string; snippet: string; agent_ids: string[] };
export type SearchMessageResult = { id: string; chat_id: string; chat_title: string; snippet: string; agent_ids: string[] };
export type SearchResponse = {
  chats: SearchChatResult[];
  messages: SearchMessageResult[];
  cursor: { next: string | null; hasMore: boolean };
};
