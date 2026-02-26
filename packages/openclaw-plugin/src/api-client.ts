import { EventSource } from "eventsource";

import type { Chat, ListChatsResponse, Media, Message, OGRequest, SearchResult } from "./types.js";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

export class OpenGramClient {
  constructor(
    private readonly baseUrl: string,
    private readonly instanceSecret?: string,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.instanceSecret) {
      headers.Authorization = `Bearer ${this.instanceSecret}`;
    }
    return headers;
  }

  private async fetchWithRetry(url: string, opts: RequestInit, retries = MAX_RETRIES): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, opts);
        if (response.ok || response.status < 500) {
          return response;
        }
        if (attempt < retries) {
          await sleep(RETRY_BASE_MS * 2 ** attempt);
          continue;
        }
        return response;
      } catch (error) {
        if (attempt < retries) {
          await sleep(RETRY_BASE_MS * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
    throw new Error("unreachable");
  }

  async createChat(params: {
    agentIds: string[];
    modelId: string;
    title?: string;
    tags?: string[];
  }): Promise<Chat> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      throw new Error(`createChat failed: ${res.status}`);
    }
    return (await res.json()) as Chat;
  }

  async listChats(params?: {
    agentId?: string;
    archived?: boolean;
    cursor?: string;
    limit?: number;
  }): Promise<ListChatsResponse> {
    const qs = new URLSearchParams();
    if (params?.agentId) {
      qs.set("agentId", params.agentId);
    }
    if (params?.archived !== undefined) {
      qs.set("archived", String(params.archived));
    }
    if (params?.cursor) {
      qs.set("cursor", params.cursor);
    }
    if (params?.limit) {
      qs.set("limit", String(params.limit));
    }

    const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats${suffix}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`listChats failed: ${res.status}`);
    }
    return (await res.json()) as ListChatsResponse;
  }

  async getMessages(chatId: string, params?: { limit?: number }): Promise<Message[]> {
    const qs = new URLSearchParams();
    if (params?.limit) {
      qs.set("limit", String(params.limit));
    }
    const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}/messages${suffix}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`getMessages failed: ${res.status}`);
    }
    const body = await res.json() as { data: Message[] };
    return body.data;
  }

  async getChat(chatId: string): Promise<Chat> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`getChat failed: ${res.status}`);
    }
    return (await res.json()) as Chat;
  }

  async updateChat(chatId: string, patch: Record<string, unknown>): Promise<Chat> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      throw new Error(`updateChat failed: ${res.status}`);
    }
    return (await res.json()) as Chat;
  }

  async createMessage(
    chatId: string,
    params: {
      role: "user" | "agent" | "system" | "tool";
      senderId: string;
      content?: string;
      streaming?: boolean;
      modelId?: string;
      trace?: object;
    },
  ): Promise<Message> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      throw new Error(`createMessage failed: ${res.status}`);
    }
    return (await res.json()) as Message;
  }

  async sendChunk(messageId: string, deltaText: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/messages/${messageId}/chunks`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ deltaText }),
    });
  }

  async completeMessage(messageId: string, finalText?: string): Promise<void> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/messages/${messageId}/complete`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ finalText }),
    });
    if (!res.ok) {
      throw new Error(`completeMessage failed: ${res.status}`);
    }
  }

  async cancelMessage(messageId: string): Promise<void> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/messages/${messageId}/cancel`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`cancelMessage failed: ${res.status}`);
    }
  }

  async cancelStreamingMessagesForChat(chatId: string): Promise<{ cancelledMessageIds: string[] }> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}/messages/cancel-streaming`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`cancelStreamingMessagesForChat failed: ${res.status}`);
    }
    return (await res.json()) as { cancelledMessageIds: string[] };
  }

  async uploadMedia(chatId: string, params: {
    file: Buffer;
    filename: string;
    contentType: string;
    messageId?: string;
  }): Promise<Media> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(params.file)], { type: params.contentType }), params.filename);
    if (params.messageId) {
      form.append("messageId", params.messageId);
    }

    const headers: Record<string, string> = {};
    if (this.instanceSecret) {
      headers.Authorization = `Bearer ${this.instanceSecret}`;
    }

    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}/media`, {
      method: "POST",
      headers,
      body: form,
    });
    if (!res.ok) {
      throw new Error(`uploadMedia failed: ${res.status}`);
    }
    return (await res.json()) as Media;
  }

  getMediaUrl(mediaId: string): string {
    return `${this.baseUrl}/api/v1/files/${mediaId}`;
  }

  async fetchMediaAsImage(mediaId: string): Promise<{
    type: "image";
    data: string;
    mimeType: string;
  } | null> {
    const url = this.getMediaUrl(mediaId);
    const headers: Record<string, string> = {};
    if (this.instanceSecret) {
      headers.Authorization = `Bearer ${this.instanceSecret}`;
    }
    const res = await this.fetchWithRetry(url, { headers });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    const mimeType = contentType.split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return { type: "image", data: buffer.toString("base64"), mimeType };
  }

  async fetchMediaAsBuffer(mediaId: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
    const url = this.getMediaUrl(mediaId);
    const headers: Record<string, string> = {};
    if (this.instanceSecret) {
      headers.Authorization = `Bearer ${this.instanceSecret}`;
    }
    const res = await this.fetchWithRetry(url, { headers });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const mimeType = contentType.split(";")[0].trim();
    const disposition = res.headers.get("content-disposition") ?? "";
    const nameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    const fileName = nameMatch ? decodeURIComponent(nameMatch[1].trim()) : mediaId;
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mimeType, fileName };
  }

  async createRequest(
    chatId: string,
    params: {
      type: "choice" | "text_input" | "form";
      title: string;
      body?: string;
      config: object;
      trace?: object;
    },
  ): Promise<OGRequest> {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}/requests`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      throw new Error(`createRequest failed: ${res.status}`);
    }
    return (await res.json()) as OGRequest;
  }

  async search(query: string, scope: "all" | "titles" | "messages" = "all"): Promise<SearchResult> {
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&scope=${scope}`,
      {
        method: "GET",
        headers: this.headers(),
      },
    );
    if (!res.ok) {
      throw new Error(`search failed: ${res.status}`);
    }
    return (await res.json()) as SearchResult;
  }

  async sendTyping(chatId: string, agentId: string): Promise<void> {
    fetch(`${this.baseUrl}/api/v1/chats/${chatId}/typing`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ agentId }),
    }).catch(() => {});
  }

  async health(): Promise<{ status: string; version: string; uptime: number }> {
    const res = await fetch(`${this.baseUrl}/api/v1/health`, { method: "GET" });
    if (!res.ok) {
      throw new Error(`health check failed: ${res.status}`);
    }
    return (await res.json()) as { status: string; version: string; uptime: number };
  }

  connectSSE(params?: { ephemeral?: boolean; cursor?: string }): EventSource {
    const qs = new URLSearchParams();
    if (params?.ephemeral !== undefined) {
      qs.set("ephemeral", String(params.ephemeral));
    }
    if (params?.cursor) {
      qs.set("cursor", params.cursor);
    }

    const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
    const url = `${this.baseUrl}/api/v1/events/stream${suffix}`;
    const secret = this.instanceSecret;

    return new EventSource(url, {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          headers: {
            ...init?.headers,
            ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
          },
        }),
    } as unknown as EventSourceInit);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
