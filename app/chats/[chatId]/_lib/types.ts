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
  agents: Agent[];
  models: Model[];
};

export type Chat = {
  id: string;
  title: string;
  title_source: 'default' | 'auto' | 'manual';
  tags: string[];
  model_id: string;
  pinned: boolean;
  is_archived: boolean;
  last_read_at?: string | null;
  unread_count?: number;
  notifications_muted: boolean;
  agent_ids: string[];
  pending_requests_count: number;
};

export type MessageRole = 'user' | 'agent' | 'system' | 'tool';

export type Message = {
  id: string;
  role: MessageRole;
  sender_id: string;
  created_at: string;
  content_final: string | null;
  content_partial: string | null;
  stream_state: 'none' | 'streaming' | 'complete' | 'cancelled';
  trace?: Record<string, unknown> | null;
};

export type MessagesResponse = {
  data: Message[];
};

export type RequestType = 'choice' | 'text_input' | 'form';

export type RequestItem = {
  id: string;
  chat_id: string;
  type: RequestType;
  status: 'pending' | 'resolved' | 'cancelled';
  title: string;
  body: string | null;
  config: Record<string, unknown>;
  created_at: string;
};

export type RequestsResponse = {
  data: RequestItem[];
};

export type MediaKind = 'image' | 'audio' | 'file';

export type MediaItem = {
  id: string;
  message_id: string | null;
  filename: string;
  created_at: string;
  byte_size: number;
  content_type: string;
  kind: MediaKind;
};

export type MediaResponse = {
  data: MediaItem[];
};

export type MediaFilter = 'all' | MediaKind;

export type TagSuggestion = {
  name: string;
  usage_count: number;
};

export type RequestDraftMap = Record<string, Record<string, unknown>>;
export type RequestErrorMap = Record<string, string | null>;

export type ChoiceVariant = 'primary' | 'secondary' | 'danger';

export type ChoiceRequestOption = {
  id: string;
  label: string;
  variant: ChoiceVariant;
};

export type ChoiceRequestConfig = {
  options: ChoiceRequestOption[];
  minSelections: number;
  maxSelections: number;
};

export type TextInputValidationConfig = {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type TextInputRequestConfig = {
  placeholder: string;
  validation: TextInputValidationConfig;
};

export type FormFieldType = 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'date';

export type FormRequestField = {
  name: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  options: string[];
};

export type FormRequestConfig = {
  fields: FormRequestField[];
  submitLabel: string;
};
