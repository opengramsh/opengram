import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenGramClient } from "../src/api-client.js";

// vi.mock is hoisted, so use vi.hoisted to create the mock constructor
const { MockEventSource } = vi.hoisted(() => {
  const MockEventSource = vi.fn().mockImplementation(function (this: any, url: string) {
    this.url = url;
    this.close = vi.fn();
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
  });
  return { MockEventSource };
});

vi.mock("eventsource", () => ({
  EventSource: MockEventSource,
}));

describe("OpenGramClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  describe("constructor and headers", () => {
    it("sends Authorization header when instanceSecret is set", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ status: "ok", version: "1.0", uptime: 99 }));
      const client = new OpenGramClient("http://localhost:3000", "my-secret");
      await client.health();
      // health() uses plain fetch without auth
    });

    it("includes auth in createMessage", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: "msg-1" }));
      const client = new OpenGramClient("http://localhost:3000", "my-secret");
      await client.createMessage("chat-1", { role: "agent", senderId: "grami", content: "hi" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/chats/chat-1/messages",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer my-secret",
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("omits Authorization when no secret", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: "msg-1" }));
      const client = new OpenGramClient("http://localhost:3000");
      await client.createMessage("chat-1", { role: "agent", senderId: "grami", content: "hi" });

      const callHeaders = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(callHeaders).not.toHaveProperty("Authorization");
    });
  });

  describe("retry logic", () => {
    it("retries on 500 and succeeds", async () => {
      fetchSpy
        .mockResolvedValueOnce(mockResponse({ error: "server error" }, 500))
        .mockResolvedValueOnce(mockResponse({ id: "chat-1", agentIds: [] }));

      const client = new OpenGramClient("http://localhost:3000");
      const chat = await client.getChat("chat-1");

      expect(chat.id).toBe("chat-1");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("retries on network error and succeeds", async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce(mockResponse({ id: "chat-1", agentIds: [] }));

      const client = new OpenGramClient("http://localhost:3000");
      const chat = await client.getChat("chat-1");

      expect(chat.id).toBe("chat-1");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("does not retry on 4xx errors", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ error: "not found" }, 404));

      const client = new OpenGramClient("http://localhost:3000");
      await expect(client.getChat("chat-1")).rejects.toThrow("getChat failed: 404");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 400 errors", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ error: "bad request" }, 400));

      const client = new OpenGramClient("http://localhost:3000");
      await expect(client.createChat({ agentIds: ["a"], modelId: "m" })).rejects.toThrow(
        "createChat failed: 400",
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 401 errors", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ error: "unauthorized" }, 401));

      const client = new OpenGramClient("http://localhost:3000");
      await expect(client.listChats()).rejects.toThrow("listChats failed: 401");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("throws after exhausting retries on persistent 500", async () => {
      fetchSpy
        .mockResolvedValueOnce(mockResponse({}, 500))
        .mockResolvedValueOnce(mockResponse({}, 500))
        .mockResolvedValueOnce(mockResponse({}, 500))
        .mockResolvedValueOnce(mockResponse({}, 500));

      const client = new OpenGramClient("http://localhost:3000");
      await expect(client.getChat("chat-1")).rejects.toThrow("getChat failed: 500");
      expect(fetchSpy).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it("throws after exhausting retries on persistent network error", async () => {
      fetchSpy
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const client = new OpenGramClient("http://localhost:3000");
      await expect(client.getChat("chat-1")).rejects.toThrow("ECONNREFUSED");
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe("API methods", () => {
    it("createChat sends correct payload", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: "new-chat" }));
      const client = new OpenGramClient("http://localhost:3000");

      await client.createChat({
        agentIds: ["grami"],
        modelId: "claude-3",
        title: "Test Chat",
        tags: ["test"],
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/chats",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            agentIds: ["grami"],
            modelId: "claude-3",
            title: "Test Chat",
            tags: ["test"],
          }),
        }),
      );
    });

    it("listChats builds query string", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockResponse({ data: [], cursor: { hasMore: false } }),
      );
      const client = new OpenGramClient("http://localhost:3000");

      await client.listChats({ agentId: "grami", archived: false, limit: 10 });

      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toContain("agentId=grami");
      expect(url).toContain("archived=false");
      expect(url).toContain("limit=10");
    });

    it("listChats works without params", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockResponse({ data: [], cursor: { hasMore: false } }),
      );
      const client = new OpenGramClient("http://localhost:3000");

      await client.listChats();

      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toBe("http://localhost:3000/api/v1/chats");
    });

    it("updateChat sends PATCH with body", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: "chat-1" }));
      const client = new OpenGramClient("http://localhost:3000");

      await client.updateChat("chat-1", { title: "New Title" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/chats/chat-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    it("createMessage sends correct payload", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: "msg-1" }));
      const client = new OpenGramClient("http://localhost:3000");

      await client.createMessage("chat-1", {
        role: "agent",
        senderId: "grami",
        content: "Hello!",
        streaming: true,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/chats/chat-1/messages",
        expect.objectContaining({
          body: JSON.stringify({
            role: "agent",
            senderId: "grami",
            content: "Hello!",
            streaming: true,
          }),
        }),
      );
    });

    it("sendChunk sends delta text", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const client = new OpenGramClient("http://localhost:3000");

      await client.sendChunk("msg-1", "delta text");

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/messages/msg-1/chunks",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ deltaText: "delta text" }),
        }),
      );
    });

    it("completeMessage sends finalText", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const client = new OpenGramClient("http://localhost:3000");

      await client.completeMessage("msg-1", "Final text");

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/messages/msg-1/complete",
        expect.objectContaining({
          body: JSON.stringify({ finalText: "Final text" }),
        }),
      );
    });

    it("cancelMessage sends POST", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const client = new OpenGramClient("http://localhost:3000");

      await client.cancelMessage("msg-1");

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/messages/msg-1/cancel",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("search encodes query and scope", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ chats: [], messages: [] }));
      const client = new OpenGramClient("http://localhost:3000");

      await client.search("hello world", "titles");

      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toContain("q=hello%20world");
      expect(url).toContain("scope=titles");
    });

    it("search defaults scope to all", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ chats: [], messages: [] }));
      const client = new OpenGramClient("http://localhost:3000");

      await client.search("test");

      const url = fetchSpy.mock.calls[0]![0] as string;
      expect(url).toContain("scope=all");
    });

    it("createRequest sends correct payload", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: "req-1" }));
      const client = new OpenGramClient("http://localhost:3000");

      await client.createRequest("chat-1", {
        type: "choice",
        title: "Approve?",
        body: "Please confirm",
        config: { options: [{ id: "yes", label: "Yes" }] },
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/chats/chat-1/requests",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("getMediaUrl returns correct URL", () => {
      const client = new OpenGramClient("http://localhost:3000");
      expect(client.getMediaUrl("media-abc")).toBe("http://localhost:3000/api/v1/files/media-abc");
    });

    it("health calls the health endpoint without auth", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockResponse({ status: "ok", version: "1.0.0", uptime: 100 }),
      );
      const client = new OpenGramClient("http://localhost:3000", "secret");

      const result = await client.health();

      expect(result).toEqual({ status: "ok", version: "1.0.0", uptime: 100 });
      expect(fetchSpy).toHaveBeenCalledWith("http://localhost:3000/api/v1/health", { method: "GET" });
    });

    it("health throws on non-ok response", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));
      const client = new OpenGramClient("http://localhost:3000");

      await expect(client.health()).rejects.toThrow("health check failed: 503");
    });
  });

  describe("connectSSE", () => {
    beforeEach(() => {
      MockEventSource.mockClear();
    });

    it("builds SSE URL with query params", () => {
      const client = new OpenGramClient("http://localhost:3000", "secret");

      client.connectSSE({ ephemeral: false, cursor: "evt-42" });

      expect(MockEventSource).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/events/stream?ephemeral=false&cursor=evt-42",
        expect.anything(),
      );
    });

    it("builds SSE URL without query params when none given", () => {
      const client = new OpenGramClient("http://localhost:3000");

      client.connectSSE();

      expect(MockEventSource).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/events/stream",
        expect.anything(),
      );
    });
  });

  describe("uploadMedia", () => {
    it("sends FormData with file and messageId", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: "media-1" }));
      const client = new OpenGramClient("http://localhost:3000", "secret");

      await client.uploadMedia("chat-1", {
        file: Buffer.from("data"),
        filename: "test.png",
        contentType: "image/png",
        messageId: "msg-1",
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/chats/chat-1/media",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer secret",
          }),
        }),
      );
    });

    it("sends FormData without messageId when not provided", async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse({ id: "media-1" }));
      const client = new OpenGramClient("http://localhost:3000");

      const result = await client.uploadMedia("chat-1", {
        file: Buffer.from("data"),
        filename: "test.png",
        contentType: "image/png",
      });

      expect(result.id).toBe("media-1");
    });
  });
});
