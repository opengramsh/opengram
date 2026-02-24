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
