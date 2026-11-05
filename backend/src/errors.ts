class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

function publicError(error: unknown) {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: 'INTERNAL_ERROR', message: 'The request could not be completed. Please try again.' };
}

function logError(error: unknown) {
  // Avoid logging database errors that may include query parameters or secrets.
  console.error(JSON.stringify({ event: 'request_failed', code: errorCode(error) || 'INTERNAL_ERROR' }));
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
export { AppError, publicError, logError };
