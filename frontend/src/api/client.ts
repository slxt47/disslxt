import type { ApiError } from '@chat-mvp/shared';

/** Error thrown for every non-2xx API response (and for network failures, with status 0). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type UnauthorizedListener = () => void;
let unauthorizedListener: UnauthorizedListener | null = null;

/** Registers a callback for 401 UNAUTHORIZED responses (session expired / logged out). */
export function onUnauthorized(listener: UnauthorizedListener | null): void {
  unauthorizedListener = listener;
}

function isApiError(body: unknown): body is ApiError {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as ApiError).error?.code === 'string'
  );
}

/**
 * fetch wrapper: same-origin `/api` paths, cookies included, JSON in/out.
 * Throws ApiRequestError with the server's `{error:{code,message,details}}`.
 */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Keine Verbindung zum Server');
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = undefined;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const err = isApiError(data)
      ? new ApiRequestError(res.status, data.error.code, data.error.message, data.error.details)
      : new ApiRequestError(res.status, 'HTTP_ERROR', `Fehler ${res.status}`);
    if (res.status === 401 && err.code === 'UNAUTHORIZED') unauthorizedListener?.();
    throw err;
  }
  return data as T;
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unbekannter Fehler';
}
