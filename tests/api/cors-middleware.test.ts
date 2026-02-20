import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/src/server";

let previousCorsOrigins: string | undefined;

function setCorsOrigins(origins: string[]) {
  if (origins.length > 0) {
    process.env.OPENGRAM_CORS_ORIGINS = origins.join(",");
  } else {
    delete process.env.OPENGRAM_CORS_ORIGINS;
  }
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

describe("API CORS middleware", () => {
  it("responds to preflight for allowed origins", async () => {
    setCorsOrigins(["https://app.example.com"]);

    const response = await app.request("/api/v1/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
  });

  it("adds CORS headers for non-OPTIONS requests from allowed origins", async () => {
    setCorsOrigins(["https://app.example.com"]);

    const response = await app.request("/api/v1/health", {
      method: "GET",
      headers: {
        Origin: "https://app.example.com",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
  });

  it("does not emit CORS headers when origin is not allowed", async () => {
    setCorsOrigins(["https://allowed.example.com"]);

    const response = await app.request("/api/v1/health", {
      method: "GET",
      headers: {
        Origin: "https://app.example.com",
      },
    });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("allows all origins when corsOrigins is empty", async () => {
    setCorsOrigins([]);

    const response = await app.request("/api/v1/health", {
      method: "GET",
      headers: {
        Origin: "https://any.example.com",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://any.example.com");
  });

  it("supports multiple allowed origins", async () => {
    setCorsOrigins(["https://one.example.com", "https://two.example.com"]);

    const r1 = await app.request("/api/v1/health", {
      method: "GET",
      headers: { Origin: "https://two.example.com" },
    });
    expect(r1.headers.get("Access-Control-Allow-Origin")).toBe("https://two.example.com");

    const r2 = await app.request("/api/v1/health", {
      method: "GET",
      headers: { Origin: "https://other.example.com" },
    });
    expect(r2.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
