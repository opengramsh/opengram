import { EventSource } from "eventsource";
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
export class OpenGramClient {
    baseUrl;
    instanceSecret;
    constructor(baseUrl, instanceSecret) {
        this.baseUrl = baseUrl;
        this.instanceSecret = instanceSecret;
    }
    headers() {
        const headers = { "Content-Type": "application/json" };
        if (this.instanceSecret) {
            headers.Authorization = `Bearer ${this.instanceSecret}`;
        }
        return headers;
    }
    async fetchWithRetry(url, opts, retries = MAX_RETRIES) {
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
            }
            catch (error) {
                if (attempt < retries) {
                    await sleep(RETRY_BASE_MS * 2 ** attempt);
                    continue;
                }
                throw error;
            }
        }
        throw new Error("unreachable");
    }
    async createChat(params) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(params),
        });
        if (!res.ok) {
            throw new Error(`createChat failed: ${res.status}`);
        }
        return (await res.json());
    }
    async listChats(params) {
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
        return (await res.json());
    }
    async getMessages(chatId, params) {
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
        const body = await res.json();
        return body.data;
    }
    async getChat(chatId) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}`, {
            method: "GET",
            headers: this.headers(),
        });
        if (!res.ok) {
            throw new Error(`getChat failed: ${res.status}`);
        }
        return (await res.json());
    }
    async updateChat(chatId, patch) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}`, {
            method: "PATCH",
            headers: this.headers(),
            body: JSON.stringify(patch),
        });
        if (!res.ok) {
            throw new Error(`updateChat failed: ${res.status}`);
        }
        return (await res.json());
    }
    async createMessage(chatId, params) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}/messages`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(params),
        });
        if (!res.ok) {
            throw new Error(`createMessage failed: ${res.status}`);
        }
        return (await res.json());
    }
    async sendChunk(messageId, deltaText) {
        await fetch(`${this.baseUrl}/api/v1/messages/${messageId}/chunks`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ deltaText }),
        });
    }
    async completeMessage(messageId, finalText) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/messages/${messageId}/complete`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ finalText }),
        });
        if (!res.ok) {
            throw new Error(`completeMessage failed: ${res.status}`);
        }
    }
    async cancelMessage(messageId) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/messages/${messageId}/cancel`, {
            method: "POST",
            headers: this.headers(),
        });
        if (!res.ok) {
            throw new Error(`cancelMessage failed: ${res.status}`);
        }
    }
    async cancelStreamingMessagesForChat(chatId) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}/messages/cancel-streaming`, {
            method: "POST",
            headers: this.headers(),
        });
        if (!res.ok) {
            throw new Error(`cancelStreamingMessagesForChat failed: ${res.status}`);
        }
        return (await res.json());
    }
    async uploadMedia(chatId, params) {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(params.file)], { type: params.contentType }), params.filename);
        if (params.messageId) {
            form.append("messageId", params.messageId);
        }
        const headers = {};
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
        return (await res.json());
    }
    getMediaUrl(mediaId) {
        return `${this.baseUrl}/api/v1/files/${mediaId}`;
    }
    async fetchMediaAsImage(mediaId) {
        const url = this.getMediaUrl(mediaId);
        const headers = {};
        if (this.instanceSecret) {
            headers.Authorization = `Bearer ${this.instanceSecret}`;
        }
        const res = await this.fetchWithRetry(url, { headers });
        if (!res.ok)
            return null;
        const contentType = res.headers.get("content-type") ?? "";
        const mimeType = contentType.split(";")[0].trim();
        if (!mimeType.startsWith("image/"))
            return null;
        const buffer = Buffer.from(await res.arrayBuffer());
        return { type: "image", data: buffer.toString("base64"), mimeType };
    }
    async fetchMediaAsBuffer(mediaId) {
        const url = this.getMediaUrl(mediaId);
        const headers = {};
        if (this.instanceSecret) {
            headers.Authorization = `Bearer ${this.instanceSecret}`;
        }
        const res = await this.fetchWithRetry(url, { headers });
        if (!res.ok)
            return null;
        const contentType = res.headers.get("content-type") ?? "application/octet-stream";
        const mimeType = contentType.split(";")[0].trim();
        const disposition = res.headers.get("content-disposition") ?? "";
        const nameMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
        const fileName = nameMatch ? decodeURIComponent(nameMatch[1].trim()) : mediaId;
        const buffer = Buffer.from(await res.arrayBuffer());
        return { buffer, mimeType, fileName };
    }
    async createRequest(chatId, params) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/chats/${chatId}/requests`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(params),
        });
        if (!res.ok) {
            throw new Error(`createRequest failed: ${res.status}`);
        }
        return (await res.json());
    }
    async search(query, scope = "all") {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&scope=${scope}`, {
            method: "GET",
            headers: this.headers(),
        });
        if (!res.ok) {
            throw new Error(`search failed: ${res.status}`);
        }
        return (await res.json());
    }
    async sendTyping(chatId, agentId) {
        fetch(`${this.baseUrl}/api/v1/chats/${chatId}/typing`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ agentId }),
        }).catch(() => { });
    }
    async claimDispatch(params) {
        const batches = await this.claimDispatchMany({
            workerId: params.workerId,
            leaseMs: params.leaseMs,
            waitMs: params.waitMs,
            limit: 1,
        });
        return batches[0] ?? null;
    }
    async claimDispatchMany(params) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/dispatch/claim-many`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(params),
        });
        if (res.status === 204) {
            return [];
        }
        if (!res.ok) {
            throw new Error(`claimDispatchMany failed: ${res.status}`);
        }
        const body = (await res.json());
        return Array.isArray(body.batches) ? body.batches : [];
    }
    async heartbeatDispatch(batchId, params) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/dispatch/${encodeURIComponent(batchId)}/heartbeat`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(params),
        });
        if (!res.ok) {
            throw new Error(`heartbeatDispatch failed: ${res.status}`);
        }
    }
    async completeDispatch(batchId, workerId) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/dispatch/${encodeURIComponent(batchId)}/complete`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({ workerId }),
        });
        if (!res.ok) {
            throw new Error(`completeDispatch failed: ${res.status}`);
        }
    }
    async failDispatch(batchId, params) {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/dispatch/${encodeURIComponent(batchId)}/fail`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(params),
        });
        if (!res.ok) {
            throw new Error(`failDispatch failed: ${res.status}`);
        }
    }
    async health() {
        const res = await fetch(`${this.baseUrl}/api/v1/health`, { method: "GET" });
        if (!res.ok) {
            throw new Error(`health check failed: ${res.status}`);
        }
        return (await res.json());
    }
    async getConfig() {
        const res = await this.fetchWithRetry(`${this.baseUrl}/api/v1/config`, {
            method: "GET",
            headers: this.headers(),
        });
        if (!res.ok) {
            throw new Error(`getConfig failed: ${res.status}`);
        }
        return (await res.json());
    }
    connectSSE(params) {
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
            fetch: (input, init) => fetch(input, {
                ...init,
                headers: {
                    ...init?.headers,
                    ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
                },
            }),
        });
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
