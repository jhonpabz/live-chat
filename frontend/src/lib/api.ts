import { type Ack, record } from './contracts';

export class RequestError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function api<T>(path: string, validate: (value: unknown) => value is T, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = record(data) && record(data.error) ? data.error : null;
    throw new RequestError(typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED', typeof error?.message === 'string' ? error.message : 'The request failed.');
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
