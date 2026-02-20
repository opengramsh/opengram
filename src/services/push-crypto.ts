import { createCipheriv, createECDH, createHmac, createSign, randomBytes } from 'node:crypto';

const KEY_LENGTH = 16;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const SHA_256_LENGTH = 32;
const RECORD_SIZE = 4096;
const DEFAULT_TTL = 2419200; // 4 weeks in seconds

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

// --- HKDF (RFC 5869, SHA-256) ---

function hmacSha256(key: Buffer, input: Buffer): Buffer {
  return createHmac('sha256', key).update(input).digest();
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return hmacSha256(salt, ikm);
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  let output = Buffer.alloc(0);
  let t = Buffer.alloc(0);
  let counter = 0;
  const counterBuf = Buffer.alloc(1);
  while (output.length < length) {
    counterBuf.writeUInt8(++counter);
    t = hmacSha256(prk, Buffer.concat([t, info, counterBuf]));
    output = Buffer.concat([output, t]);
  }
  return output.subarray(0, length);
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return hkdfExpand(hkdfExtract(salt, ikm), info, length);
}

// --- VAPID JWT (ES256) ---

function base64urlEncode(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function createVapidJwt(audience: string, vapid: VapidDetails): string {
  const header = base64urlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const payload = base64urlEncode(JSON.stringify({ aud: audience, exp, sub: vapid.subject }));

  const unsignedToken = `${header}.${payload}`;

  // Build PEM from raw private key bytes
  const privateKeyRaw = Buffer.from(vapid.privateKey, 'base64url');
  const pem = rawKeyToPem(privateKeyRaw);

  const sign = createSign('SHA256');
  sign.update(unsignedToken);
  const derSignature = sign.sign(pem);

  // Convert DER signature to raw r||s (64 bytes)
  const rawSig = derToRaw(derSignature);
  const signature = base64urlEncode(rawSig);

  return `${unsignedToken}.${signature}`;
}

function rawKeyToPem(privateKey: Buffer): string {
  // ASN.1 DER encoding for EC private key (prime256v1/P-256)
  const ecPrivateKeyPrefix = Buffer.from([
    0x30, 0x77, // SEQUENCE (119 bytes)
    0x02, 0x01, 0x01, // INTEGER 1 (version)
    0x04, 0x20, // OCTET STRING (32 bytes - private key)
  ]);
  const ecParams = Buffer.from([
    0xa0, 0x0a, // [0] EXPLICIT (10 bytes)
    0x06, 0x08, // OID (8 bytes)
    0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // prime256v1
  ]);
  const der = Buffer.concat([ecPrivateKeyPrefix, privateKey, ecParams]);
  const b64 = der.toString('base64');
  return `-----BEGIN EC PRIVATE KEY-----\n${b64}\n-----END EC PRIVATE KEY-----`;
}

function derToRaw(derSignature: Buffer): Buffer {
  // Parse DER SEQUENCE { INTEGER r, INTEGER s }
  // DER format: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  let offset = 2; // skip SEQUENCE tag and length
  if (derSignature[0] !== 0x30) throw new Error('Invalid DER signature');

  // Read r
  if (derSignature[offset] !== 0x02) throw new Error('Invalid DER signature');
  offset++;
  const rLen = derSignature[offset]!;
  offset++;
  let r = derSignature.subarray(offset, offset + rLen);
  offset += rLen;

  // Read s
  if (derSignature[offset] !== 0x02) throw new Error('Invalid DER signature');
  offset++;
  const sLen = derSignature[offset]!;
  offset++;
  let s = derSignature.subarray(offset, offset + sLen);

  // Strip leading zeros (DER integers are signed, may have leading 0x00)
  if (r.length === 33 && r[0] === 0) r = r.subarray(1);
  if (s.length === 33 && s[0] === 0) s = s.subarray(1);

  // Pad to 32 bytes each
  const raw = Buffer.alloc(64);
  r.copy(raw, 32 - r.length);
  s.copy(raw, 64 - s.length);
  return raw;
}

// --- RFC 8291 Payload Encryption (aes128gcm) ---

function encryptPayload(
  payload: string,
  p256dh: string,
  authSecret: string,
): { ciphertext: Buffer; localPublicKey: Buffer } {
  const userPublicKey = Buffer.from(p256dh, 'base64url');
  const userAuth = Buffer.from(authSecret, 'base64url');
  const payloadBuffer = Buffer.from(payload, 'utf8');

  // Generate ephemeral ECDH key pair
  const localCurve = createECDH('prime256v1');
  const localPublicKey = localCurve.generateKeys();
  const salt = randomBytes(16);

  // Shared secret via ECDH
  const sharedSecret = localCurve.computeSecret(userPublicKey);

  // IKM = HKDF(auth, shared_secret, "WebPush: info\0" || receiver_pub || sender_pub, 32)
  const ikm = hkdf(
    userAuth,
    sharedSecret,
    Buffer.concat([
      Buffer.from('WebPush: info\0', 'ascii'),
      userPublicKey,
      localPublicKey,
    ]),
    SHA_256_LENGTH,
  );

  // Derive content encryption key and nonce
  const prk = hkdfExtract(salt, ikm);
  const contentEncryptionKey = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), KEY_LENGTH);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'ascii'), NONCE_LENGTH);

  // Encrypt: plaintext + padding delimiter (0x02 for last record)
  const padding = Buffer.from([2]); // final record delimiter
  const gcm = createCipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  const encrypted = Buffer.concat([
    gcm.update(payloadBuffer),
    gcm.update(padding),
    gcm.final(),
    gcm.getAuthTag(),
  ]);

  // Build aes128gcm header: salt(16) + rs(4) + keyid_len(1) + keyid(65)
  const header = Buffer.alloc(5);
  header.writeUInt32BE(RECORD_SIZE, 0);
  header.writeUInt8(localPublicKey.length, 4);

  const ciphertext = Buffer.concat([salt, header, localPublicKey, encrypted]);

  return { ciphertext, localPublicKey };
}

// --- Public API ---

export async function sendWebPushNotification(
  subscription: PushSubscription,
  payload: string,
  vapid: VapidDetails,
): Promise<SendResult> {
  const parsedUrl = new URL(subscription.endpoint);
  const audience = `${parsedUrl.protocol}//${parsedUrl.host}`;

  // VAPID authorization
  const jwt = createVapidJwt(audience, vapid);
  const authorization = `vapid t=${jwt}, k=${vapid.publicKey}`;

  // Encrypt payload
  const { ciphertext } = encryptPayload(payload, subscription.keys.p256dh, subscription.keys.auth);

  // Send to push service
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(ciphertext.length),
      TTL: String(DEFAULT_TTL),
      Urgency: 'normal',
    },
    body: ciphertext,
  });

  if (response.status < 200 || response.status > 299) {
    const error = new Error('Push notification failed') as Error & { statusCode: number };
    error.statusCode = response.status;
    throw error;
  }

  return { statusCode: response.status };
}
