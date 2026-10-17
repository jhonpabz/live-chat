class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function publicError(error) {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: 'INTERNAL_ERROR', message: 'The request could not be completed. Please try again.' };
}

function logError(error) {
  // Avoid logging database errors that may include query parameters or secrets.
  console.error(JSON.stringify({ event: 'request_failed', code: error.code || 'INTERNAL_ERROR' }));
}

module.exports = { AppError, publicError, logError };
