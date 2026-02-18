import { NextResponse } from 'next/server';

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

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validationError(message: string, details?: unknown) {
  return new ApiError(400, 'VALIDATION_ERROR', message, details);
}

export function notFoundError(message: string, details?: unknown) {
  return new ApiError(404, 'NOT_FOUND', message, details);
}

export function internalError(message: string, details?: unknown) {
  return new ApiError(500, 'INTERNAL_ERROR', message, details);
}

export function successCollection<T>(data: T[], next: string | null, hasMore: boolean) {
  return NextResponse.json({
    data,
    cursor: {
      next,
      hasMore,
    },
  });
}

export function successOk() {
  return NextResponse.json({ ok: true });
}

export function toErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  return NextResponse.json(
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
  try {
    return (await request.json()) as T;
  } catch {
    throw validationError('Invalid JSON body.');
  }
}
