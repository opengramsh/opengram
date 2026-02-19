import { beforeEach, describe, expect, it, vi } from "vitest";

describe("openclaw-plugin api client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("retries transient failures and succeeds", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("oops", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const { OpenGramClient } = await import("../../packages/openclaw-plugin/src/api-client.ts");
    const client = new OpenGramClient("http://localhost:3000", "secret");

    const promise = client.createMessage("chat-1", {
      role: "agent",
      senderId: "agent-1",
      content: "hello",
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.id).toBe("msg-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry 4xx responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const { OpenGramClient } = await import("../../packages/openclaw-plugin/src/api-client.ts");
    const client = new OpenGramClient("http://localhost:3000");

    await expect(
      client.createMessage("chat-1", {
        role: "agent",
        senderId: "agent-1",
      }),
    ).rejects.toThrow("createMessage failed: 400");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("connectSSE constructs an EventSource with query params", async () => {
    const { OpenGramClient } = await import("../../packages/openclaw-plugin/src/api-client.ts");
    const client = new OpenGramClient("http://localhost:3000", "secret");

    const stream = client.connectSSE({ ephemeral: true, cursor: "abc" });
    expect(stream).toBeDefined();
    stream.close();
  });
});
