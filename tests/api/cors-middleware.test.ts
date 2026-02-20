import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

let previousCorsOrigins: string | undefined;

function setCorsOrigins(origins: string[]) {
  if (origins.length > 0) {
    process.env.OPENGRAM_CORS_ORIGINS = origins.join(",");
  } else {
    delete process.env.OPENGRAM_CORS_ORIGINS;
  }
}

function createRequest(url: string, method: string, headers?: Record<string, string>) {
  return new NextRequest(new Request(url, { method, headers }));
}

beforeEach(() => {
  previousCorsOrigins = process.env.OPENGRAM_CORS_ORIGINS;
});

afterEach(() => {
  if (previousCorsOrigins === undefined) {
    delete process.env.OPENGRAM_CORS_ORIGINS;
  } else {
    process.env.OPENGRAM_CORS_ORIGINS = previousCorsOrigins;
  }
});

describe("API CORS proxy", () => {
  it("responds to preflight for allowed origins", () => {
    setCorsOrigins(["https://app.example.com"]);

    const response = proxy(
      createRequest("http://localhost/api/v1/chats", "OPTIONS", {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("content-type,authorization");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
    expect(response.headers.get("Vary")).toContain("Origin");
    expect(response.headers.get("Vary")).toContain("Access-Control-Request-Headers");
  });

  it("adds CORS headers for non-OPTIONS requests from allowed origins", () => {
    setCorsOrigins(["https://app.example.com"]);

    const response = proxy(
      createRequest("http://localhost/api/v1/chats", "GET", {
        Origin: "https://app.example.com",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("does not emit CORS headers when origin is not allowed", () => {
    setCorsOrigins(["https://allowed.example.com"]);

    const response = proxy(
      createRequest("http://localhost/api/v1/chats", "GET", {
        Origin: "https://app.example.com",
      }),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("defaults to same-origin behavior when corsOrigins is empty", () => {
    setCorsOrigins([]);

    const response = proxy(
      createRequest("http://localhost/api/v1/chats", "OPTIONS", {
        Origin: "https://app.example.com",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Headers")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("supports multiple allowed origins", () => {
    setCorsOrigins(["https://one.example.com", "https://two.example.com"]);

    const r1 = proxy(
      createRequest("http://localhost/api/v1/chats", "GET", {
        Origin: "https://two.example.com",
      }),
    );
    expect(r1.headers.get("Access-Control-Allow-Origin")).toBe("https://two.example.com");

    const r2 = proxy(
      createRequest("http://localhost/api/v1/chats", "GET", {
        Origin: "https://other.example.com",
      }),
    );
    expect(r2.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("uses default allowed headers when no request headers specified", () => {
    setCorsOrigins(["https://app.example.com"]);

    const response = proxy(
      createRequest("http://localhost/api/v1/chats", "OPTIONS", {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "POST",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });
});
