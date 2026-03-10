import { describe, expect, it, vi } from "vitest";

describe("openclaw-plugin media", () => {
  it("downloads media and derives filename from URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Buffer.from("abc"), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    );

    const { downloadMedia } = await import("../src/media.ts");
    const result = await downloadMedia("https://files.example/path/photo.png");

    expect(result.buffer.toString()).toBe("abc");
    expect(result.contentType).toBe("image/png");
    expect(result.filename).toBe("photo.png");
  });

  it("falls back to extension from mime type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Buffer.from("abc"), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        }),
      ),
    );

    const { downloadMedia } = await import("../src/media.ts");
    const result = await downloadMedia("https://files.example/path/");

    expect(result.filename).toBe("file.mpga");
  });
});
