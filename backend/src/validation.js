const { AppError } = require('./errors');

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_INPUT', 'Expected an object.');
  }
  return value;
}

function text(value, field, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new AppError(400, 'INVALID_INPUT', `${field} must be nonempty and at most ${max} characters.`);
  }
  return value;
}

function uuid(value, field = 'id') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError(400, 'INVALID_INPUT', `${field} must be a UUID.`);
  }
  return value;
}

function page(value = {}) {
  const data = object(value);
  const limit = data.limit === undefined ? 50 : Number(data.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (data.after && data.before)) {
    throw new AppError(400, 'INVALID_INPUT', 'Use a limit from 1 to 100 and only one cursor.');
  }
  return { limit, after: data.after === undefined ? null : uuid(data.after, 'after'), before: data.before === undefined ? null : uuid(data.before, 'before') };
}

module.exports = { object, text, uuid, page };
