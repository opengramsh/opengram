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

function readFromBootstrap(): string | null {
  if (typeof window === 'undefined') return null;
  const w = window as typeof window & { __OPENGRAM_BOOTSTRAP__?: { instanceSecret?: string | null } };
  return w.__OPENGRAM_BOOTSTRAP__?.instanceSecret?.trim() || null;
}

export function getApiSecret(): string | null {
  if (cachedSecret === undefined) {
    const bootstrap = readFromBootstrap();
    const stored = readFromStorage();

    // Prefer bootstrap (server-injected, always current) over localStorage (may be stale)
    cachedSecret = bootstrap || stored || null;

    // Sync localStorage when bootstrap provides a different value
    if (bootstrap && bootstrap !== stored) {
      try {
        window.localStorage.setItem(STORAGE_KEY, bootstrap);
      } catch {
        // localStorage can be blocked
      }
    }
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
