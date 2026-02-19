import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { loadOpengramConfig } from "@/src/config/opengram-config";

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const DEFAULT_ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "Idempotency-Key",
  "X-Instance-Secret",
];

function appendVaryHeader(headers: Headers, value: string) {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }

  const values = current.split(",").map((entry) => entry.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) {
    headers.set("Vary", `${current}, ${value}`);
  }
}

function isOriginAllowed(origin: string, allowedOrigins: string[]) {
  return allowedOrigins.includes(origin);
}

function buildCorsHeaders(request: NextRequest, origin: string) {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  appendVaryHeader(headers, "Origin");

  const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
  headers.set(
    "Access-Control-Allow-Headers",
    requestedHeaders && requestedHeaders.trim() ? requestedHeaders : DEFAULT_ALLOWED_HEADERS.join(", "),
  );
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS.join(", "));
  return headers;
}

export function applyCorsHeadersIfAllowed(request: NextRequest, response: NextResponse) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return response;
  }

  const allowedOrigins = loadOpengramConfig().server.corsOrigins;
  if (!allowedOrigins.length || !isOriginAllowed(origin, allowedOrigins)) {
    return response;
  }

  const corsHeaders = buildCorsHeaders(request, origin);
  corsHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });

  return response;
}

export function handleApiCors(request: NextRequest) {
  if (request.method === "OPTIONS") {
    const preflightResponse = new NextResponse(null, { status: 204 });
    return applyCorsHeadersIfAllowed(request, preflightResponse);
  }

  return applyCorsHeadersIfAllowed(request, NextResponse.next());
}
