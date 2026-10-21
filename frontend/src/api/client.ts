import type { ApiError } from '@disslxt/shared';

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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') headers['content-type'] = 'application/json';

  return send<T>(path, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** POSTs raw bytes (e.g. an audio recording) with their own Content-Type; JSON response. */
export function apiUpload<T>(path: string, body: Blob, contentType: string): Promise<T> {
  return send<T>(path, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': contentType },
    body,
  });
}

/**
 * Uploads raw bytes with upload progress (fetch has no upload progress, XHR does).
 * Errors are the same ApiRequestError as everywhere else; aborting rejects with code ABORTED.
 */
export function apiUploadWithProgress<T>(
  path: string,
  body: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('accept', 'application/json');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
    };
    xhr.onerror = () =>
      reject(new ApiRequestError(0, 'NETWORK_ERROR', 'Keine Verbindung zum Server'));
    xhr.onabort = () => reject(new ApiRequestError(0, 'ABORTED', 'Abgebrochen'));
    xhr.onload = () => {
      let data: unknown;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
        return;
      }
      const err = isApiError(data)
        ? new ApiRequestError(xhr.status, data.error.code, data.error.message, data.error.details)
        : new ApiRequestError(
            xhr.status,
            'HTTP_ERROR',
            xhr.status === 413 ? 'Die Datei ist zu groß (max. 25 MB)' : `Fehler ${xhr.status}`,
          );
      if (xhr.status === 401 && err.code === 'UNAUTHORIZED') unauthorizedListener?.();
      reject(err);
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
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
