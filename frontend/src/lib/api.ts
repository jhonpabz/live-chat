import { type Ack, record } from './contracts';

export class RequestError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function responseError(response: Response): RequestError {
  if (response.status === 429) return new RequestError('RATE_LIMITED', 'Too many requests. Please wait before trying again.');
  if (response.status >= 500) return new RequestError('SERVER_UNAVAILABLE', 'The support server is unavailable. Check that the backend is running, then try again.');
  if (!response.ok) return new RequestError('REQUEST_FAILED', 'The request failed. Please try again.');
  return new RequestError('INVALID_RESPONSE', 'The server returned an invalid response. Please try again.');
}

export async function api<T>(path: string, validate: (value: unknown) => value is T, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init?.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (failure) {
    if (init?.signal?.aborted) throw failure;
    throw new RequestError('SERVER_UNAVAILABLE', 'Cannot reach the support server. Check your connection and that the backend is running.');
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (failure) {
    if (init?.signal?.aborted) throw failure;
    // Development/reverse proxies may return empty or HTML errors when Node is down.
    throw responseError(response);
  }
  if (!response.ok) {
    const error = record(data) && record(data.error) ? data.error : null;
    const fallback = responseError(response);
    throw new RequestError(typeof error?.code === 'string' ? error.code : fallback.code, typeof error?.message === 'string' ? error.message : fallback.message);
  }
  if (!validate(data)) throw new RequestError('INVALID_RESPONSE', 'The server returned an invalid response.');
  return data;
}

export async function acknowledged<T>(request: Promise<Ack<T>>): Promise<T> {
  let result: Ack<T>;
  try { result = await request; } catch { throw new RequestError('TIMEOUT', 'No confirmation received. Retry to check whether your message was saved.'); }
  if (!result.ok) throw new RequestError(result.error.code, result.error.message);
  return result.data;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
