export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly headers?: HeadersInit;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
    headers?: HeadersInit,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export function validationError(message: string, details?: unknown) {
  return new ApiError(400, 'VALIDATION_ERROR', message, details);
}

export function notFoundError(message: string, details?: unknown) {
  return new ApiError(404, 'NOT_FOUND', message, details);
}

export function unauthorizedError(message: string, details?: unknown) {
  return new ApiError(401, 'UNAUTHORIZED', message, details);
}

export function conflictError(message: string, details?: unknown) {
  return new ApiError(409, 'CONFLICT', message, details);
}

export function rateLimitedError(message: string, retryAfterSeconds: number, details?: unknown) {
  return new ApiError(429, 'RATE_LIMITED', message, details, {
    'Retry-After': String(retryAfterSeconds),
  });
}

export function payloadTooLargeError(message: string, details?: unknown) {
  return new ApiError(413, 'PAYLOAD_TOO_LARGE', message, details);
}

export function unsupportedMediaTypeError(message: string, details?: unknown) {
  return new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', message, details);
}

export function internalError(message: string, details?: unknown) {
  return new ApiError(500, 'INTERNAL_ERROR', message, details);
}

export function successCollection<T>(data: T[], next: string | null, hasMore: boolean) {
  return Response.json({
    data,
    cursor: {
      next,
      hasMore,
    },
  });
}

export function successOk() {
  return Response.json({ ok: true });
}

export function toErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      {
        status: error.status,
        headers: error.headers,
      },
    );
  }

  return Response.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error.',
      },
    },
    { status: 500 },
  );
}

export async function parseJsonBody<T>(request: Request): Promise<T> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw validationError('Invalid JSON body.');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw validationError('JSON body must be an object.');
  }

  return parsed as T;
}
