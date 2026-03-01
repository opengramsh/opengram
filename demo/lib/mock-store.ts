// In-memory data store for the demo — holds all chats, messages, requests, and config.

import { nanoid } from 'nanoid';

// ── Types ──────────────────────────────────────────────────────────────

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
  notifications_muted: boolean;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

export type MessageRole = 'user' | 'agent' | 'system' | 'tool';

export type Message = {
  id: string;
  chat_id: string;
  role: MessageRole;
  sender_id: string;
  created_at: string;
  updated_at: string;
  content_final: string | null;
  content_partial: string | null;
  stream_state: 'none' | 'streaming' | 'complete' | 'cancelled';
  model_id: string | null;
  trace: Record<string, unknown> | null;
};

export type RequestItem = {
  id: string;
  chat_id: string;
  type: 'choice' | 'text_input' | 'form';
  status: 'pending' | 'resolved' | 'cancelled';
  title: string;
  body: string | null;
  config: Record<string, unknown>;
  created_at: string;
};

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

export type DemoConfig = {
  appName: string;
  maxUploadBytes: number;
  allowedMimeTypes: string[];
  titleMaxChars: number;
  defaultModelIdForNewChats: string;
  agents: Agent[];
  models: Model[];
  push: { enabled: boolean; vapidPublicKey: string; subject: string };
  security: { instanceSecretEnabled: boolean; readEndpointsRequireInstanceSecret: boolean };
  server: {
    publicBaseUrl: string;
    port: number;
    streamTimeoutSeconds: number;
    idempotencyTtlSeconds: number;
    dispatch: Record<string, unknown>;
  };
  hooks: never[];
  autoRename: null;
  autoRenameProviders: never[];
};

// ── State ──────────────────────────────────────────────────────────────

const chats = new Map<string, Chat>();
const messagesByChat = new Map<string, Message[]>();
const requestsByChat = new Map<string, RequestItem[]>();

// ── Config ─────────────────────────────────────────────────────────────

const AGENTS: Agent[] = [
  { id: 'assistant', name: 'AI Assistant', description: 'General-purpose AI assistant' },
  { id: 'support', name: 'Support Bot', description: 'Handles support queries and tasks' },
  { id: 'creative', name: 'Creative Writer', description: 'Helps with creative writing and content' },
];

const MODELS: Model[] = [
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Fast and capable' },
  { id: 'claude-sonnet', name: 'Claude Sonnet', description: 'Balanced performance' },
];

export const demoConfig: DemoConfig = {
  appName: 'OpenGram Demo',
  maxUploadBytes: 20 * 1024 * 1024,
  allowedMimeTypes: ['image/*', 'audio/*', 'application/pdf', 'text/*'],
  titleMaxChars: 100,
  defaultModelIdForNewChats: 'gpt-4o',
  agents: AGENTS,
  models: MODELS,
  push: { enabled: false, vapidPublicKey: '', subject: '' },
  security: { instanceSecretEnabled: false, readEndpointsRequireInstanceSecret: false },
  server: {
    publicBaseUrl: 'https://demo.opengram.sh',
    port: 443,
    streamTimeoutSeconds: 120,
    idempotencyTtlSeconds: 300,
    dispatch: {},
  },
  hooks: [],
  autoRename: null,
  autoRenameProviders: [],
};

// ── Helpers ────────────────────────────────────────────────────────────

function ts(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function generateId(): string {
  return nanoid(12);
}

function makeMessage(
  chatId: string,
  role: MessageRole,
  senderId: string,
  content: string,
  createdAt: string,
): Message {
  return {
    id: generateId(),
    chat_id: chatId,
    role,
    sender_id: senderId,
    created_at: createdAt,
    updated_at: createdAt,
    content_final: content,
    content_partial: null,
    stream_state: 'none',
    model_id: role === 'agent' ? 'gpt-4o' : null,
    trace: null,
  };
}

// ── Seed data ──────────────────────────────────────────────────────────

function seed() {
  const now = Date.now();

  // Chat 1 — "Getting Started"
  const chat1Id = 'demo-getting-started';
  const chat1Messages: Message[] = [
    makeMessage(chat1Id, 'user', 'user:primary', 'Hello! What is OpenGram?', new Date(now - 300000).toISOString()),
    makeMessage(
      chat1Id,
      'agent',
      'assistant',
      `**OpenGram** is an open-source, self-hosted chat platform that lets you connect AI agents to your conversations.\n\nHere are some highlights:\n\n- **Multi-agent support** — add multiple AI agents to a single chat\n- **Streaming responses** — see agent replies in real time\n- **Media sharing** — send images, audio, and files\n- **Pending requests** — agents can ask for user input with choice buttons, text fields, or forms\n- **Tags & pinning** — organize your conversations\n- **Full-text search** — find any message instantly`,
      new Date(now - 295000).toISOString(),
    ),
    makeMessage(chat1Id, 'user', 'user:primary', 'Can you show me some markdown?', new Date(now - 200000).toISOString()),
    makeMessage(
      chat1Id,
      'agent',
      'assistant',
      `# Markdown Demo\n\nSure! Here's what OpenGram can render:\n\n## Text formatting\n**Bold**, *italic*, ~~strikethrough~~, and \`inline code\`.\n\n## Lists\n1. Ordered item one\n2. Ordered item two\n\n- Unordered bullet\n- Another bullet\n\n## Blockquote\n> "The best way to predict the future is to invent it." — Alan Kay\n\n## Code block\n\`\`\`python\ndef greet(name: str) -> str:\n    return f"Hello, {name}! Welcome to OpenGram."\n\nprint(greet("World"))\n\`\`\`\n\n## Table\n| Feature | Status |\n|---------|--------|\n| Markdown | Done |\n| LaTeX math | Done |\n| Mermaid diagrams | Done |`,
      new Date(now - 195000).toISOString(),
    ),
    makeMessage(chat1Id, 'user', 'user:primary', 'That looks great! How do I deploy it?', new Date(now - 100000).toISOString()),
    makeMessage(
      chat1Id,
      'agent',
      'assistant',
      `Deploying OpenGram is straightforward:\n\n\`\`\`bash\nnpm install -g opengram\nopengram setup\nopengram start\n\`\`\`\n\nYou can also use Docker:\n\n\`\`\`bash\ndocker run -d -p 3334:3334 opengram/opengram\n\`\`\`\n\nCheck out [opengram.sh](https://opengram.sh) for the full documentation.`,
      new Date(now - 95000).toISOString(),
    ),
  ];

  chats.set(chat1Id, {
    id: chat1Id,
    is_archived: false,
    title: 'Getting Started',
    title_source: 'manual',
    tags: ['demo', 'tutorial'],
    pinned: false,
    agent_ids: ['assistant'],
    model_id: 'gpt-4o',
    last_message_preview: 'Deploying OpenGram is straightforward...',
    last_message_role: 'agent',
    pending_requests_count: 0,
    last_read_at: new Date(now).toISOString(),
    unread_count: 0,
    notifications_muted: false,
    created_at: new Date(now - 300000).toISOString(),
    updated_at: new Date(now - 95000).toISOString(),
    last_message_at: new Date(now - 95000).toISOString(),
  });
  messagesByChat.set(chat1Id, chat1Messages);
  requestsByChat.set(chat1Id, []);

  // Chat 2 — "Project Planning" with a pending choice request
  const chat2Id = 'demo-project-planning';
  const chat2Messages: Message[] = [
    makeMessage(chat2Id, 'user', 'user:primary', 'I need help planning our next sprint.', new Date(now - 500000).toISOString()),
    makeMessage(
      chat2Id,
      'agent',
      'support',
      `I'd be happy to help with sprint planning! Let me break this down:\n\n### Current backlog priorities\n1. **User authentication** — implement OAuth2 login\n2. **Dashboard redesign** — new analytics widgets\n3. **API rate limiting** — protect against abuse\n4. **Mobile responsive fixes** — address reported layout issues\n\nI've created a quick decision below to help prioritize. Which area should we focus on first?`,
      new Date(now - 495000).toISOString(),
    ),
    makeMessage(chat2Id, 'user', 'user:primary', 'Good overview. Let me think about the priority.', new Date(now - 400000).toISOString()),
    makeMessage(
      chat2Id,
      'agent',
      'support',
      `Take your time! I've sent you a quick-pick below so you can let me know when you're ready. \n\nIn the meantime, here's a rough effort estimate:\n\n| Task | Effort | Impact |\n|------|--------|--------|\n| OAuth2 | 5 days | High |\n| Dashboard | 3 days | Medium |\n| Rate limiting | 2 days | High |\n| Mobile fixes | 1 day | Medium |`,
      new Date(now - 395000).toISOString(),
    ),
  ];

  const chat2Request: RequestItem = {
    id: 'demo-request-1',
    chat_id: chat2Id,
    type: 'choice',
    status: 'pending',
    title: 'Sprint priority',
    body: 'Which area should we focus on this sprint?',
    config: {
      options: [
        { id: 'auth', label: 'User Authentication', variant: 'primary' },
        { id: 'dashboard', label: 'Dashboard Redesign', variant: 'secondary' },
        { id: 'rate-limit', label: 'API Rate Limiting', variant: 'secondary' },
        { id: 'mobile', label: 'Mobile Fixes', variant: 'secondary' },
      ],
      minSelections: 1,
      maxSelections: 2,
    },
    created_at: new Date(now - 395000).toISOString(),
  };

  chats.set(chat2Id, {
    id: chat2Id,
    is_archived: false,
    title: 'Project Planning',
    title_source: 'manual',
    tags: ['work'],
    pinned: false,
    agent_ids: ['support'],
    model_id: 'gpt-4o',
    last_message_preview: 'Take your time! I\'ve sent you a quick-pick...',
    last_message_role: 'agent',
    pending_requests_count: 1,
    last_read_at: new Date(now - 400000).toISOString(),
    unread_count: 1,
    notifications_muted: false,
    created_at: new Date(now - 500000).toISOString(),
    updated_at: new Date(now - 395000).toISOString(),
    last_message_at: new Date(now - 395000).toISOString(),
  });
  messagesByChat.set(chat2Id, chat2Messages);
  requestsByChat.set(chat2Id, [chat2Request]);

  // Chat 3 — "Creative Writing" (pinned, tagged)
  const chat3Id = 'demo-creative-writing';
  const chat3Messages: Message[] = [
    makeMessage(chat3Id, 'user', 'user:primary', 'Write me a short poem about open source software.', new Date(now - 600000).toISOString()),
    makeMessage(
      chat3Id,
      'agent',
      'creative',
      `Here's a short poem for you:\n\n---\n\n### The Open Garden\n\n*Lines of code like seeds are sown,*\n*In repos where the wild thoughts have grown.*\n*No walls, no gates, the garden's free —*\n*A commons built for you and me.*\n\n*Pull requests bloom like springtime flowers,*n*Reviewed through late and moonlit hours.*\n*Each merge a stitch in fabric shared,*\n*A quilt of minds that showed they cared.*\n\n---\n\nWant me to try a different style? I can do haiku, limerick, or free verse.`,
      new Date(now - 595000).toISOString(),
    ),
    makeMessage(chat3Id, 'user', 'user:primary', 'Love it! Try a haiku.', new Date(now - 550000).toISOString()),
    makeMessage(
      chat3Id,
      'agent',
      'creative',
      `### Open Source Haiku\n\n*Forked beneath the stars,*\n*Branches merge in silent code —*\n*Freedom, line by line.*`,
      new Date(now - 545000).toISOString(),
    ),
  ];

  chats.set(chat3Id, {
    id: chat3Id,
    is_archived: false,
    title: 'Creative Writing',
    title_source: 'manual',
    tags: ['creative', 'fun'],
    pinned: true,
    agent_ids: ['creative'],
    model_id: 'claude-sonnet',
    last_message_preview: 'Open Source Haiku — Forked beneath the stars...',
    last_message_role: 'agent',
    pending_requests_count: 0,
    last_read_at: new Date(now).toISOString(),
    unread_count: 0,
    notifications_muted: false,
    created_at: new Date(now - 600000).toISOString(),
    updated_at: new Date(now - 545000).toISOString(),
    last_message_at: new Date(now - 545000).toISOString(),
  });
  messagesByChat.set(chat3Id, chat3Messages);
  requestsByChat.set(chat3Id, []);
}

// Run seed on module load
seed();

// ── CRUD helpers ───────────────────────────────────────────────────────

export function getChats(archived = false): Chat[] {
  return [...chats.values()]
    .filter((c) => c.is_archived === archived)
    .sort((a, b) => {
      // Pinned first, then by last_message_at desc
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aTime = a.last_message_at ?? a.created_at;
      const bTime = b.last_message_at ?? b.created_at;
      return bTime.localeCompare(aTime);
    });
}

export function getChat(id: string): Chat | undefined {
  return chats.get(id);
}

export function createChat(params: {
  agentIds: string[];
  modelId: string;
  title?: string;
  tags?: string[];
}): Chat {
  const id = generateId();
  const now = ts();
  const chat: Chat = {
    id,
    is_archived: false,
    title: params.title ?? 'New Chat',
    title_source: params.title ? 'manual' : 'default',
    tags: params.tags ?? [],
    pinned: false,
    agent_ids: params.agentIds,
    model_id: params.modelId,
    last_message_preview: null,
    last_message_role: null,
    pending_requests_count: 0,
    last_read_at: now,
    unread_count: 0,
    notifications_muted: false,
    created_at: now,
    updated_at: now,
    last_message_at: null,
  };
  chats.set(id, chat);
  messagesByChat.set(id, []);
  requestsByChat.set(id, []);
  return chat;
}

export function updateChat(
  id: string,
  updates: {
    title?: string;
    titleAutoRenamed?: boolean;
    tags?: string[];
    pinned?: boolean;
    modelId?: string;
    notificationsMuted?: boolean;
  },
): Chat | undefined {
  const chat = chats.get(id);
  if (!chat) return undefined;

  if (updates.title !== undefined) {
    chat.title = updates.title;
    chat.title_source = updates.titleAutoRenamed ? 'auto' : 'manual';
  }
  if (updates.tags !== undefined) chat.tags = updates.tags;
  if (updates.pinned !== undefined) chat.pinned = updates.pinned;
  if (updates.modelId !== undefined) chat.model_id = updates.modelId;
  if (updates.notificationsMuted !== undefined) chat.notifications_muted = updates.notificationsMuted;
  chat.updated_at = ts();

  return chat;
}

export function archiveChat(id: string): boolean {
  const chat = chats.get(id);
  if (!chat) return false;
  chat.is_archived = true;
  chat.updated_at = ts();
  return true;
}

export function unarchiveChat(id: string): boolean {
  const chat = chats.get(id);
  if (!chat) return false;
  chat.is_archived = false;
  chat.updated_at = ts();
  return true;
}

export function markChatRead(id: string): boolean {
  const chat = chats.get(id);
  if (!chat) return false;
  chat.last_read_at = ts();
  chat.unread_count = 0;
  return true;
}

export function getMessages(chatId: string): Message[] {
  return messagesByChat.get(chatId) ?? [];
}

export function addMessage(
  chatId: string,
  role: MessageRole,
  senderId: string,
  content: string,
  options?: { streaming?: boolean; modelId?: string },
): Message {
  const now = ts();
  const msg: Message = {
    id: generateId(),
    chat_id: chatId,
    role,
    sender_id: senderId,
    created_at: now,
    updated_at: now,
    content_final: options?.streaming ? null : content,
    content_partial: options?.streaming ? '' : null,
    stream_state: options?.streaming ? 'streaming' : 'none',
    model_id: options?.modelId ?? null,
    trace: null,
  };

  const msgs = messagesByChat.get(chatId);
  if (msgs) {
    msgs.push(msg);
  } else {
    messagesByChat.set(chatId, [msg]);
  }

  // Update chat preview
  const chat = chats.get(chatId);
  if (chat) {
    const preview = content.length > 80 ? content.slice(0, 80) + '...' : content;
    chat.last_message_preview = preview;
    chat.last_message_role = role;
    chat.last_message_at = now;
    chat.updated_at = now;
  }

  return msg;
}

export function updateMessage(messageId: string, updates: Partial<Message>): Message | undefined {
  for (const msgs of messagesByChat.values()) {
    const msg = msgs.find((m) => m.id === messageId);
    if (msg) {
      Object.assign(msg, updates, { updated_at: ts() });
      return msg;
    }
  }
  return undefined;
}

export function getRequests(chatId: string, status?: string): RequestItem[] {
  const reqs = requestsByChat.get(chatId) ?? [];
  if (!status || status === 'all') return reqs;
  return reqs.filter((r) => r.status === status);
}

export function resolveRequest(requestId: string, _payload: Record<string, unknown>): RequestItem | undefined {
  for (const [chatId, reqs] of requestsByChat.entries()) {
    const req = reqs.find((r) => r.id === requestId);
    if (req) {
      req.status = 'resolved';
      const chat = chats.get(chatId);
      if (chat) {
        chat.pending_requests_count = reqs.filter((r) => r.status === 'pending').length;
      }
      return req;
    }
  }
  return undefined;
}

export function cancelRequest(requestId: string): RequestItem | undefined {
  for (const [chatId, reqs] of requestsByChat.entries()) {
    const req = reqs.find((r) => r.id === requestId);
    if (req) {
      req.status = 'cancelled';
      const chat = chats.get(chatId);
      if (chat) {
        chat.pending_requests_count = reqs.filter((r) => r.status === 'pending').length;
      }
      return req;
    }
  }
  return undefined;
}

export function getPendingSummary(): { pending_requests_total: number } {
  let total = 0;
  for (const chat of chats.values()) {
    if (!chat.is_archived) total += chat.pending_requests_count;
  }
  return { pending_requests_total: total };
}

export function getUnreadSummary(): { total_unread: number; unread_by_agent: Record<string, number> } {
  let totalUnread = 0;
  const byAgent: Record<string, number> = {};
  for (const chat of chats.values()) {
    if (!chat.is_archived && chat.unread_count > 0) {
      totalUnread += chat.unread_count;
      for (const agentId of chat.agent_ids) {
        byAgent[agentId] = (byAgent[agentId] ?? 0) + chat.unread_count;
      }
    }
  }
  return { total_unread: totalUnread, unread_by_agent: byAgent };
}

export function searchStore(query: string) {
  const q = query.toLowerCase();
  const chatResults: { id: string; title: string; snippet: string; agent_ids: string[] }[] = [];
  const messageResults: { id: string; chat_id: string; chat_title: string; snippet: string; agent_ids: string[] }[] = [];

  for (const chat of chats.values()) {
    if (chat.title.toLowerCase().includes(q)) {
      chatResults.push({ id: chat.id, title: chat.title, snippet: chat.last_message_preview ?? '', agent_ids: chat.agent_ids });
    }

    const msgs = messagesByChat.get(chat.id) ?? [];
    for (const msg of msgs) {
      const text = msg.content_final ?? msg.content_partial ?? '';
      if (text.toLowerCase().includes(q)) {
        const idx = text.toLowerCase().indexOf(q);
        const start = Math.max(0, idx - 30);
        const end = Math.min(text.length, idx + q.length + 30);
        messageResults.push({
          id: msg.id,
          chat_id: chat.id,
          chat_title: chat.title,
          snippet: (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : ''),
          agent_ids: chat.agent_ids,
        });
      }
    }
  }

  return { chats: chatResults, messages: messageResults, cursor: { next: null, hasMore: false } };
}

export function getTagSuggestions(): { name: string; usage_count: number }[] {
  const counts = new Map<string, number>();
  for (const chat of chats.values()) {
    for (const tag of chat.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, usage_count]) => ({ name, usage_count }))
    .sort((a, b) => b.usage_count - a.usage_count);
}
