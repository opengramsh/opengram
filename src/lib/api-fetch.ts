const STORAGE_KEY = 'opengram.instanceSecret';

let cachedSecret: string | null | undefined;

function readFromStorage(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function getApiSecret(): string | null {
  if (cachedSecret === undefined) {
    cachedSecret = readFromStorage();
  }

  return cachedSecret;
}

export function setApiSecret(secret: string | null) {
  cachedSecret = secret?.trim() || null;

  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (cachedSecret) {
      window.localStorage.setItem(STORAGE_KEY, cachedSecret);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage can be blocked.
  }
}

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const secret = getApiSecret();
  if (!secret) {
    return fetch(input, init);
  }

  const headers = new Headers(init?.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${secret}`);
  }

  return fetch(input, { ...init, headers });
}

export function buildFileUrl(mediaId: string, variant?: string): string {
  const base = variant
    ? `/api/v1/files/${mediaId}/${variant}`
    : `/api/v1/files/${mediaId}`;

  const secret = getApiSecret();
  if (!secret) {
    return base;
  }

  return `${base}?token=${encodeURIComponent(secret)}`;
}
