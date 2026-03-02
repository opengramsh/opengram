/**
 * Extract the OpenAPI 3.1 spec from the Hono app and write it to docs/public/openapi.json.
 *
 * Usage:  NODE_ENV=test npx tsx scripts/extract-openapi-spec.ts
 *
 * NODE_ENV=test prevents server startup, DB init, and background jobs (guarded in src/server.ts).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Ensure NODE_ENV=test so server.ts skips startup side effects
process.env.NODE_ENV = "test";

// Mock the DB module before importing app — some service modules call getDb() at import time
const { app } = await import("@/src/server.ts");

const doc = app.getOpenAPIDocument({
  openapi: "3.1.0",
  info: {
    title: "Opengram API",
    version: "0.1.0",
    description: "API for the Opengram messaging platform.",
  },
  servers: [{ url: "/", description: "Current instance root" }],
  tags: [
    { name: "Chats", description: "Chat lifecycle management" },
    { name: "Messages", description: "Message creation, streaming, and listing" },
    { name: "Media", description: "Media upload, metadata, and listing" },
    { name: "Files", description: "File and thumbnail downloads" },
    { name: "Requests", description: "Interactive request management (choices, forms)" },
    { name: "Dispatch", description: "Agent dispatch batch claiming and lifecycle" },
    { name: "Events", description: "Server-sent event streaming" },
    { name: "Config", description: "Instance configuration" },
    { name: "Push", description: "Web push notification subscriptions" },
    { name: "Search", description: "Full-text search across chats and messages" },
    { name: "Tags", description: "Tag suggestions" },
    { name: "Health", description: "Health check" },
  ],
});

const outDir = path.join(root, "docs", "public");
mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, "openapi.json");
writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");

console.log(`OpenAPI spec written to ${path.relative(root, outPath)}`);
