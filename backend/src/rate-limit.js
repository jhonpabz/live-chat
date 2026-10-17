const { AppError } = require('./errors');

function createRateLimit({ limit, windowMs, maxKeys = 10000, now = Date.now }) {
  const buckets = new Map();
  return key => {
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.expires <= time) {
      if (buckets.size >= maxKeys) {
        for (const [entry, value] of buckets) if (value.expires <= time) buckets.delete(entry);
        if (buckets.size >= maxKeys) throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
      }
      bucket = { count: 0, expires: time + windowMs };
      buckets.set(key, bucket);
    }
    if (++bucket.count > limit) throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  };
}

module.exports = { createRateLimit };
