const STORAGE_KEY = 'opengram.instanceSecret';

let cachedSecret: string | null | undefined;

function writeToStorage(secret: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (secret) {
      window.localStorage.setItem(STORAGE_KEY, secret);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage can be blocked.
  }
}

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

function readFromBootstrap(): { present: boolean; value: string | null } {
  if (typeof window === 'undefined') {
    return { present: false, value: null };
  }

  const w = window as typeof window & { __OPENGRAM_BOOTSTRAP__?: { instanceSecret?: string | null } };
  const bootstrap = w.__OPENGRAM_BOOTSTRAP__;
  if (!bootstrap || !Object.prototype.hasOwnProperty.call(bootstrap, 'instanceSecret')) {
    return { present: false, value: null };
  }

  return {
    present: true,
    value: bootstrap.instanceSecret?.trim() || null,
  };
}

export function getApiSecret(): string | null {
  if (cachedSecret === undefined) {
    const bootstrap = readFromBootstrap();

    if (bootstrap.present) {
      // Bootstrap is authoritative, including explicit null when secrets are disabled.
      cachedSecret = bootstrap.value;
      writeToStorage(cachedSecret);
    } else {
      // Dev mode / non-SSR entry where bootstrap is absent.
      cachedSecret = readFromStorage();
    }
  }

  return cachedSecret;
}

export function setApiSecret(secret: string | null) {
  cachedSecret = secret?.trim() || null;
  writeToStorage(cachedSecret);
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
