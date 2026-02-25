import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';

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

type SubscriptionFixture = {
  subscription: WebPushSubscription;
  privateKey: Buffer;
  publicKey: Buffer;
  authSecret: Buffer;
};

function createSubscriptionFixture(): SubscriptionFixture {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = randomBytes(16);

  return {
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-id',
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: authSecret.toString('base64url'),
      },
    },
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey(),
    authSecret,
  };
}

function createSubscription(): WebPushSubscription {
  return createSubscriptionFixture().subscription;
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

function hmacSha256(key: Buffer, input: Buffer): Buffer {
  return createHmac('sha256', key).update(input).digest();
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return hmacSha256(salt, ikm);
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  let output = Buffer.alloc(0);
  let previous = Buffer.alloc(0);
  let counter = 1;

  while (output.length < length) {
    previous = hmacSha256(prk, Buffer.concat([previous, info, Buffer.from([counter])]));
    output = Buffer.concat([output, previous]);
    counter += 1;
  }

  return output.subarray(0, length);
}

function decryptWebPushCiphertext(
  ciphertext: Buffer,
  receiverPrivateKey: Buffer,
  receiverPublicKey: Buffer,
  authSecret: Buffer,
): string {
  const salt = ciphertext.subarray(0, 16);
  const keyIdLength = ciphertext.readUInt8(20);
  const keyStart = 21;
  const keyEnd = keyStart + keyIdLength;
  const senderPublicKey = ciphertext.subarray(keyStart, keyEnd);
  const encryptedWithTag = ciphertext.subarray(keyEnd);
  const encrypted = encryptedWithTag.subarray(0, -16);
  const authTag = encryptedWithTag.subarray(-16);

  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(receiverPrivateKey);
  const sharedSecret = ecdh.computeSecret(senderPublicKey);

  const ikm = hkdfExpand(
    hkdfExtract(authSecret, sharedSecret),
    Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), receiverPublicKey, senderPublicKey]),
    32,
  );
  const prk = hkdfExtract(salt, ikm);
  const contentEncryptionKey = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12);

  const decipher = createDecipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  expect(plaintext.length).toBeGreaterThan(0);
  expect(plaintext.at(-1)).toBe(0x02);

  return plaintext.subarray(0, -1).toString('utf8');
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
    expect(headers['Crypto-Key']).toBeUndefined();

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

  it('produces RFC 8291-compatible ciphertext decryptable by the subscription keys', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const payload = JSON.stringify({ title: 'Interop', body: 'Decrypt me', data: { chatId: 'chat-1' } });
    const fixture = createSubscriptionFixture();

    await sendWebPushNotification(fixture.subscription, payload, createVapidDetails());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const ciphertext = Buffer.from(init.body as Buffer);
    const decryptedPayload = decryptWebPushCiphertext(ciphertext, fixture.privateKey, fixture.publicKey, fixture.authSecret);

    expect(decryptedPayload).toBe(payload);
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
