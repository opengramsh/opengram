import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('facehash/next', () => ({
  toFacehashHandler: () => ({
    GET: async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }),
  }),
}));

import { GET as avatarGet } from '@/app/api/avatar/route';
import { GET as mediaGet, POST as mediaPost } from '@/app/api/v1/chats/[chatId]/media/route';
import { POST as chatsPost } from '@/app/api/v1/chats/route';
import { GET as fileGet } from '@/app/api/v1/files/[mediaId]/route';
import { GET as thumbnailGet } from '@/app/api/v1/files/[mediaId]/thumbnail/route';
import { DELETE as mediaByIdDelete, GET as mediaByIdGet } from '@/app/api/v1/media/[mediaId]/route';
import { resetWriteRateLimitForTests } from '@/src/api/write-controls';

type ChatContext = { params: Promise<{ chatId: string }> };
type MediaContext = { params: Promise<{ mediaId: string }> };

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationSql = readFileSync(join(repoRoot, 'drizzle', '0000_initial.sql'), 'utf8');
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
const FILE_RESPONSE_CSP = "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

let db: Database.Database;
let tempDir: string;
let previousConfigPath: string | undefined;

function chatContext(chatId: string): ChatContext {
  return { params: Promise.resolve({ chatId }) };
}

function mediaContext(mediaId: string): MediaContext {
  return { params: Promise.resolve({ mediaId }) };
}

function createJsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createChat() {
  const chatResponse = await chatsPost(
    createJsonRequest('http://localhost/api/v1/chats', 'POST', {
      title: 'media-chat',
      agentIds: ['agent-default'],
      modelId: 'model-default',
    }),
  );
  return chatResponse.json() as Promise<{ id: string }>;
}

async function uploadBase64Media(
  chatId: string,
  fileName: string,
  contentType: string,
  bytes: Buffer,
  extra: { kind?: 'image' | 'audio' | 'file'; messageId?: string } = {},
) {
  return mediaPost(
    createJsonRequest(`http://localhost/api/v1/chats/${chatId}/media`, 'POST', {
      fileName,
      contentType,
      base64Data: bytes.toString('base64'),
      ...extra,
    }),
    chatContext(chatId),
  );
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'opengram-media-api-'));
  const dbPath = join(tempDir, 'test.db');

  previousConfigPath = process.env.OPENGRAM_CONFIG_PATH;
  process.env.DATABASE_URL = dbPath;
  process.env.OPENGRAM_DATA_ROOT = tempDir;

  db = new Database(dbPath);
  db.exec(migrationSql);
  resetWriteRateLimitForTests();
});

afterEach(() => {
  db.close();
  delete process.env.DATABASE_URL;
  delete process.env.OPENGRAM_DATA_ROOT;

  if (previousConfigPath === undefined) {
    delete process.env.OPENGRAM_CONFIG_PATH;
  } else {
    process.env.OPENGRAM_CONFIG_PATH = previousConfigPath;
  }

  resetWriteRateLimitForTests();
});

describe('media API', () => {
  it('uploads multipart image media with auto-kind, metadata, and thumbnail file', async () => {
    const chat = await createChat();

    const form = new FormData();
    form.set('file', new File([Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64')], 'avatar.png', { type: 'image/png' }));

    const uploadResponse = await mediaPost(
      new Request(`http://localhost/api/v1/chats/${chat.id}/media`, { method: 'POST', body: form }),
      chatContext(chat.id),
    );
    const uploaded = await uploadResponse.json();

    expect(uploadResponse.status).toBe(201);
    expect(uploaded.kind).toBe('image');
    expect(uploaded.thumbnail_path).toContain('/thumbnails/');

    const metadataResponse = await mediaByIdGet(
      createJsonRequest(`http://localhost/api/v1/media/${uploaded.id}`, 'GET'),
      mediaContext(uploaded.id),
    );
    const metadata = await metadataResponse.json();

    expect(metadataResponse.status).toBe(200);
    expect(metadata.id).toBe(uploaded.id);
    expect(metadata.thumbnail_path).toBe(uploaded.thumbnail_path);

    const thumbnailResponse = await thumbnailGet(
      createJsonRequest(`http://localhost/api/v1/files/${uploaded.id}/thumbnail`, 'GET'),
      mediaContext(uploaded.id),
    );

    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get('content-type')).toBe('image/webp');
    expect(thumbnailResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Number(thumbnailResponse.headers.get('content-length'))).toBeGreaterThan(0);
    expect((await thumbnailResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('lists media with kind filter and cursor pagination', async () => {
    const chat = await createChat();

    await uploadBase64Media(chat.id, 'a.webm', 'audio/webm', Buffer.from('audio-1'));
    await uploadBase64Media(chat.id, 'b.txt', 'text/plain', Buffer.from('note-1'));
    await uploadBase64Media(chat.id, 'c.webm', 'audio/webm', Buffer.from('audio-2'));

    const page1Response = await mediaGet(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}/media?kind=audio&limit=1`, 'GET'),
      chatContext(chat.id),
    );
    const page1 = await page1Response.json();

    expect(page1Response.status).toBe(200);
    expect(page1.data).toHaveLength(1);
    expect(page1.data[0].kind).toBe('audio');
    expect(page1.cursor.hasMore).toBe(true);

    const page2Response = await mediaGet(
      createJsonRequest(
        `http://localhost/api/v1/chats/${chat.id}/media?kind=audio&limit=1&cursor=${encodeURIComponent(page1.cursor.next)}`,
        'GET',
      ),
      chatContext(chat.id),
    );
    const page2 = await page2Response.json();

    expect(page2Response.status).toBe(200);
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0].kind).toBe('audio');
    expect(page2.cursor.hasMore).toBe(false);
    expect(page2.cursor.next).toBeNull();
  });

  it('serves files with range support and emits media.attached', async () => {
    const chat = await createChat();

    const uploadResponse = await uploadBase64Media(chat.id, 'voice.webm', 'audio/webm', Buffer.from('fake-audio'));
    const uploaded = await uploadResponse.json();

    expect(uploadResponse.status).toBe(201);

    const fullResponse = await fileGet(
      createJsonRequest(`http://localhost/api/v1/files/${uploaded.id}`, 'GET'),
      mediaContext(uploaded.id),
    );

    expect(fullResponse.status).toBe(200);
    expect(fullResponse.headers.get('content-type')).toBe('audio/webm');
    expect(fullResponse.headers.get('accept-ranges')).toBe('bytes');
    expect(fullResponse.headers.get('content-disposition')).toBe('inline; filename="voice.webm"');
    expect(fullResponse.headers.get('content-security-policy')).toBe(FILE_RESPONSE_CSP);
    expect(fullResponse.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(fullResponse.text()).resolves.toBe('fake-audio');

    const partialResponse = await fileGet(
      new Request(`http://localhost/api/v1/files/${uploaded.id}`, {
        method: 'GET',
        headers: { range: 'bytes=0-3' },
      }),
      mediaContext(uploaded.id),
    );

    expect(partialResponse.status).toBe(206);
    expect(partialResponse.headers.get('content-range')).toBe('bytes 0-3/10');
    await expect(partialResponse.text()).resolves.toBe('fake');

    const unsatisfiableResponse = await fileGet(
      new Request(`http://localhost/api/v1/files/${uploaded.id}`, {
        method: 'GET',
        headers: { range: 'bytes=999-1000' },
      }),
      mediaContext(uploaded.id),
    );

    expect(unsatisfiableResponse.status).toBe(416);
    expect(unsatisfiableResponse.headers.get('content-range')).toBe('bytes */10');

    const event = db
      .prepare('SELECT type, payload FROM events ORDER BY created_at DESC LIMIT 1')
      .get() as { type: string; payload: string };
    expect(event.type).toBe('media.attached');
    expect(JSON.parse(event.payload)).toMatchObject({
      chatId: chat.id,
      mediaId: uploaded.id,
      kind: 'audio',
    });
  });

  it('serves non-inline MIME types as attachment with nosniff', async () => {
    const chat = await createChat();

    const uploadResponse = await uploadBase64Media(chat.id, 'note.txt', 'text/plain', Buffer.from('note-text'));
    const uploaded = await uploadResponse.json();
    expect(uploadResponse.status).toBe(201);

    const response = await fileGet(
      createJsonRequest(`http://localhost/api/v1/files/${uploaded.id}`, 'GET'),
      mediaContext(uploaded.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="note.txt"');
    expect(response.headers.get('content-security-policy')).toBe(FILE_RESPONSE_CSP);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.text()).resolves.toBe('note-text');
  });

  it('rejects SVG uploads even when wildcard MIME rules are configured', async () => {
    const configPath = join(tempDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        maxUploadBytes: 1024,
        allowedMimeTypes: ['*/*'],
      }),
    );
    process.env.OPENGRAM_CONFIG_PATH = configPath;

    const chat = await createChat();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const response = await uploadBase64Media(chat.id, 'evil.svg', 'image/svg+xml', svg);

    expect(response.status).toBe(415);
  });

  it('serves legacy SVG media as attachment with CSP and nosniff headers', async () => {
    const chat = await createChat();
    const mediaId = 'MED000000000000000001';
    const relativePath = `uploads/${chat.id}/${mediaId}.svg`;
    mkdirSync(join(tempDir, 'uploads', chat.id), { recursive: true });
    writeFileSync(join(tempDir, relativePath), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    db.prepare(
      [
        'INSERT INTO media (id, chat_id, message_id, storage_path, thumbnail_path, filename, content_type, byte_size, kind, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      mediaId,
      chat.id,
      null,
      relativePath,
      null,
      'legacy.svg',
      'image/svg+xml',
      46,
      'image',
      Date.now(),
    );

    const response = await fileGet(
      createJsonRequest(`http://localhost/api/v1/files/${mediaId}`, 'GET'),
      mediaContext(mediaId),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="legacy.svg"');
    expect(response.headers.get('content-security-policy')).toBe(FILE_RESPONSE_CSP);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('returns 404 for thumbnail endpoint on non-image media', async () => {
    const chat = await createChat();
    const uploadResponse = await uploadBase64Media(chat.id, 'voice.webm', 'audio/webm', Buffer.from('fake-audio'));
    const uploaded = await uploadResponse.json();

    const thumbnailResponse = await thumbnailGet(
      createJsonRequest(`http://localhost/api/v1/files/${uploaded.id}/thumbnail`, 'GET'),
      mediaContext(uploaded.id),
    );

    expect(thumbnailResponse.status).toBe(404);
  });

  it('deletes unattached media via /api/v1/media/[mediaId] and removes upload file', async () => {
    const chat = await createChat();
    const uploadResponse = await uploadBase64Media(chat.id, 'voice.webm', 'audio/webm', Buffer.from('fake-audio'));
    const uploaded = await uploadResponse.json();
    expect(uploadResponse.status).toBe(201);

    const deleteResponse = await mediaByIdDelete(
      createJsonRequest(`http://localhost/api/v1/media/${uploaded.id}`, 'DELETE'),
      mediaContext(uploaded.id),
    );

    expect(deleteResponse.status).toBe(200);
    expect((await deleteResponse.json()).id).toBe(uploaded.id);

    const metadataResponse = await mediaByIdGet(
      createJsonRequest(`http://localhost/api/v1/media/${uploaded.id}`, 'GET'),
      mediaContext(uploaded.id),
    );
    expect(metadataResponse.status).toBe(404);

    const uploadsDir = join(tempDir, 'uploads', chat.id);
    const files = existsSync(uploadsDir) ? readdirSync(uploadsDir) : [];
    expect(files.some((name) => name.includes(uploaded.id))).toBe(false);
  });

  it('returns 409 when deleting media attached to a message', async () => {
    const chat = await createChat();
    const now = Date.now();
    const messageId = 'MSG000000000000000001';
    db.prepare(
      [
        'INSERT INTO messages (id, chat_id, role, sender_id, created_at, updated_at, content_final, stream_state)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ].join(' '),
    ).run(
      messageId,
      chat.id,
      'user',
      'user:primary',
      now,
      now,
      null,
      'complete',
    );

    const uploadResponse = await uploadBase64Media(
      chat.id,
      'voice.webm',
      'audio/webm',
      Buffer.from('fake-audio'),
      { kind: 'audio', messageId },
    );
    const uploaded = await uploadResponse.json();
    expect(uploadResponse.status).toBe(201);

    const deleteResponse = await mediaByIdDelete(
      createJsonRequest(`http://localhost/api/v1/media/${uploaded.id}`, 'DELETE'),
      mediaContext(uploaded.id),
    );
    expect(deleteResponse.status).toBe(409);
  });

  it('returns 415 and 413 for MIME and size validation failures', async () => {
    const configPath = join(tempDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        maxUploadBytes: 4,
        allowedMimeTypes: ['audio/*'],
      }),
    );
    process.env.OPENGRAM_CONFIG_PATH = configPath;

    const chat = await createChat();

    const unsupportedTypeResponse = await uploadBase64Media(
      chat.id,
      'file.txt',
      'text/plain',
      Buffer.from('abcd'),
    );
    expect(unsupportedTypeResponse.status).toBe(415);

    const tooLargeResponse = await uploadBase64Media(
      chat.id,
      'file.webm',
      'audio/webm',
      Buffer.from('too-large'),
    );
    expect(tooLargeResponse.status).toBe(413);
  });

  it('rejects oversized multipart bodies before parsing form data', async () => {
    const configPath = join(tempDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        maxUploadBytes: 4,
        allowedMimeTypes: ['*/*'],
      }),
    );
    process.env.OPENGRAM_CONFIG_PATH = configPath;

    const chat = await createChat();
    const body = '--x\r\nContent-Disposition: form-data; name="file"; filename="tiny.txt"\r\nContent-Type: text/plain\r\n\r\nok\r\n--x--\r\n';

    const response = await mediaPost(
      new Request(`http://localhost/api/v1/chats/${chat.id}/media`, {
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': '999999',
        },
        body,
      }),
      chatContext(chat.id),
    );

    expect(response.status).toBe(413);
  });

  it('rejects multipart files exceeding maxUploadBytes via streamed file read', async () => {
    const configPath = join(tempDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        maxUploadBytes: 4,
        allowedMimeTypes: ['*/*'],
      }),
    );
    process.env.OPENGRAM_CONFIG_PATH = configPath;

    const chat = await createChat();
    const form = new FormData();
    form.set('file', new File([Buffer.from('too-large')], 'big.txt', { type: 'text/plain' }));

    const response = await mediaPost(
      new Request(`http://localhost/api/v1/chats/${chat.id}/media`, {
        method: 'POST',
        body: form,
      }),
      chatContext(chat.id),
    );

    expect(response.status).toBe(413);
  });

  it('returns 415 when image payload bytes are not a decodable image', async () => {
    const configPath = join(tempDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        maxUploadBytes: 1024,
        allowedMimeTypes: ['image/*'],
      }),
    );
    process.env.OPENGRAM_CONFIG_PATH = configPath;

    const chat = await createChat();
    const response = await uploadBase64Media(chat.id, 'broken.png', 'image/png', Buffer.from('not-an-image'));

    expect(response.status).toBe(415);
  });

  it('does not leave orphaned upload files when messageId is invalid', async () => {
    const chat = await createChat();

    const uploadResponse = await mediaPost(
      createJsonRequest(`http://localhost/api/v1/chats/${chat.id}/media`, 'POST', {
        fileName: 'voice.webm',
        contentType: 'audio/webm',
        base64Data: Buffer.from('fake-audio').toString('base64'),
        messageId: 'missing-message-id',
      }),
      chatContext(chat.id),
    );

    expect(uploadResponse.status).toBe(400);

    const uploadsDir = join(tempDir, 'uploads', chat.id);
    if (existsSync(uploadsDir)) {
      expect(readdirSync(uploadsDir)).toHaveLength(0);
    } else {
      expect(existsSync(uploadsDir)).toBe(false);
    }
  });

  it('serves facehash avatar image via /api/avatar', async () => {
    const response = await avatarGet(new Request('http://localhost/api/avatar?name=agent-default'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
