import { createCipheriv, createECDH, createHmac, createPrivateKey, createSign, randomBytes } from 'node:crypto';

const AES_128_KEY_BYTES = 16;
const NONCE_BYTES = 12;
const RECORD_SIZE = 4096;
const VAPID_TTL_SECONDS = 12 * 60 * 60;
const PUSH_TTL_SECONDS = 2419200;

type PushSubscription = {
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

type SendResult = {
  statusCode: number;
};

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function decodeBase64Url(value: string, field: string): Buffer {
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    throw new Error(`Invalid base64url value for ${field}.`);
  }
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

function splitUncompressedPublicKey(publicKey: Buffer) {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error('VAPID public key must be an uncompressed P-256 key.');
  }

  return {
    x: publicKey.subarray(1, 33),
    y: publicKey.subarray(33, 65),
  };
}

function createVapidJwt(audience: string, vapid: VapidDetails): string {
  const vapidPublicKey = decodeBase64Url(vapid.publicKey, 'vapid public key');
  const vapidPrivateKey = decodeBase64Url(vapid.privateKey, 'vapid private key');
  if (vapidPrivateKey.length !== 32) {
    throw new Error('VAPID private key must be a 32-byte P-256 scalar.');
  }

  const { x, y } = splitUncompressedPublicKey(vapidPublicKey);
  const privateKey = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: base64UrlEncode(vapidPrivateKey),
      x: base64UrlEncode(x),
      y: base64UrlEncode(y),
      ext: true,
    },
    format: 'jwk',
  });

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = base64UrlEncode(JSON.stringify({ aud: audience, exp: now + VAPID_TTL_SECONDS, sub: vapid.subject }));
  const unsignedToken = `${header}.${payload}`;

  const signer = createSign('SHA256');
  signer.update(unsignedToken);
  const signature = signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });

  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

function encryptPayload(
  payload: string,
  p256dh: string,
  authSecret: string,
): { ciphertext: Buffer } {
  const clientPublicKey = decodeBase64Url(p256dh, 'subscription.keys.p256dh');
  const clientAuthSecret = decodeBase64Url(authSecret, 'subscription.keys.auth');
  if (clientAuthSecret.length === 0) {
    throw new Error('subscription.keys.auth must not be empty.');
  }

  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const serverPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(clientPublicKey);

  const ikm = hkdfExpand(
    hkdfExtract(clientAuthSecret, sharedSecret),
    Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), clientPublicKey, serverPublicKey]),
    32,
  );

  const salt = randomBytes(16);
  const prk = hkdfExtract(salt, ikm);
  const contentEncryptionKey = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), AES_128_KEY_BYTES);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'ascii'), NONCE_BYTES);

  const plaintext = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([0x02])]);
  const cipher = createCipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const recordHeader = Buffer.alloc(5);
  recordHeader.writeUInt32BE(RECORD_SIZE, 0);
  recordHeader.writeUInt8(serverPublicKey.length, 4);

  return { ciphertext: Buffer.concat([salt, recordHeader, serverPublicKey, encrypted, authTag]) };
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

export async function sendWebPushNotification(
  subscription: PushSubscription,
  payload: string,
  vapid: VapidDetails,
): Promise<SendResult> {
  const audience = new URL(subscription.endpoint).origin;
  const jwt = createVapidJwt(audience, vapid);
  const authorization = `vapid t=${jwt}, k=${vapid.publicKey}`;
  const { ciphertext } = encryptPayload(payload, subscription.keys.p256dh, subscription.keys.auth);

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Crypto-Key': `p256ecdsa=${vapid.publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(ciphertext.length),
      TTL: String(PUSH_TTL_SECONDS),
      Urgency: 'normal',
    },
    body: ciphertext,
  });

  if (!response.ok) {
    const error = new Error('Push notification failed') as Error & { statusCode: number };
    error.statusCode = response.status;
    throw error;
  }

  return { statusCode: response.status };
}
