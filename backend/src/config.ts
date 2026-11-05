function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET']) {
    if (!env[key]) throw new Error(`${key} is required. See backend/.env.example.`);
  }
  const databaseUrl = required(env, 'DATABASE_URL');
  const redisUrl = required(env, 'REDIS_URL');
  const jwtSecret = required(env, 'JWT_SECRET');
  if (jwtSecret.length < 32 || jwtSecret.startsWith('replace-') || jwtSecret === 'your-super-secret-jwt-key-change-this') {
    throw new Error('JWT_SECRET must be a unique secret of at least 32 characters.');
  }
  for (const [key, protocols] of [['DATABASE_URL', ['postgres:', 'postgresql:']], ['REDIS_URL', ['redis:', 'rediss:']]] as const) {
    try {
      if (!protocols.some(protocol => protocol === new URL(required(env, key)).protocol)) throw new Error();
    } catch {
      throw new Error(`${key} must be a valid connection URL.`);
    }
  }
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be from 1 to 65535.');
  if (env.NODE_ENV === 'production' && !env.ALLOWED_ORIGINS) throw new Error('ALLOWED_ORIGINS is required in production.');
  const origins = (env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim());
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error();
    } catch {
      throw new Error('ALLOWED_ORIGINS must contain comma-separated HTTP origins without paths.');
    }
  }
  return { port, origins, databaseUrl, redisUrl, jwtSecret };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(key + ' is required. See backend/.env.example.');
  return value;
}
export { loadConfig };
