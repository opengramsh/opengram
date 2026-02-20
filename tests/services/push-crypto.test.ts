import { createECDH, randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendWebPushNotification } from '@/src/services/push-crypto';

type WebPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type VapidDetails = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

function createSubscription(): WebPushSubscription {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();

  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-id',
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

function createVapidDetails(): VapidDetails {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();

  return {
    subject: 'mailto:test@example.com',
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('push crypto', () => {
  it('sends encrypted push payload with VAPID authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const payload = JSON.stringify({ title: 'OpenGram', body: 'Push message body' });
    const subscription = createSubscription();
    const vapid = createVapidDetails();

    const now = Math.floor(Date.now() / 1000);
    const result = await sendWebPushNotification(subscription, payload, vapid);

    expect(result).toEqual({ statusCode: 201 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe(subscription.endpoint);
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers.TTL).toBe('2419200');
    expect(headers['Crypto-Key']).toBe(`p256ecdsa=${vapid.publicKey}`);

    const authorization = headers.Authorization;
    expect(authorization).toContain('vapid t=');
    expect(authorization).toContain(`k=${vapid.publicKey}`);

    const tokenMatch = /^vapid t=([^,]+), k=/.exec(authorization);
    expect(tokenMatch).not.toBeNull();

    const token = tokenMatch?.[1];
    expect(token).toBeTruthy();

    const [, payloadSegment] = String(token).split('.');
    const decodedPayload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as {
      aud: string;
      exp: number;
      sub: string;
    };

    expect(decodedPayload.aud).toBe('https://fcm.googleapis.com');
    expect(decodedPayload.sub).toBe(vapid.subject);
    expect(decodedPayload.exp).toBeGreaterThan(now + 11 * 60 * 60);
    expect(decodedPayload.exp).toBeLessThanOrEqual(now + 13 * 60 * 60);

    const body = init.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.length).toBeGreaterThan(Buffer.byteLength(payload, 'utf8'));
    expect(headers['Content-Length']).toBe(String(body.length));
  });

  it('throws with statusCode for non-success push response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('gone', { status: 410 }));
    vi.stubGlobal('fetch', fetchMock);

    const payload = JSON.stringify({ title: 'OpenGram', body: 'Push message body' });

    await expect(sendWebPushNotification(createSubscription(), payload, createVapidDetails())).rejects.toMatchObject({
      statusCode: 410,
    });
  });

  it('rejects invalid VAPID private key format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendWebPushNotification(createSubscription(), '{}', {
      subject: 'mailto:test@example.com',
      publicKey: createVapidDetails().publicKey,
      privateKey: 'invalid-key',
    })).rejects.toThrow('VAPID private key must be a 32-byte P-256 scalar.');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
