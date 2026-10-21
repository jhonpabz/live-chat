require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
const http = require('node:http');
const { Server } = require('socket.io');
const { Pool, types } = require('pg');
const redis = require('redis');
const { loadConfig } = require('./src/config');
const { createAuth } = require('./src/auth');
const { createChatRepository } = require('./src/chat.repository');
const { createChatService } = require('./src/chat.service');
const { createApp } = require('./src/app');
const { registerRealtime } = require('./src/realtime');
const { logError } = require('./src/errors');
const { Presence } = require('./src/presence');
const { createChatEvents } = require('./src/chat.events');
const { createAccountsRepository } = require('./src/accounts.repository');
const { createAccountsService } = require('./src/accounts.service');

async function start() {
  const config = loadConfig();
  // The existing schema uses timestamps without a timezone. Interpret them as UTC.
  types.setTypeParser(1114, value => {
    const [seconds, fraction = ''] = value.replace(' ', 'T').split('.');
    return `${seconds}.${fraction.padEnd(6, '0')}Z`;
  });
  const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, options: '-c timezone=UTC -c statement_timeout=10000' });
  pool.on('error', logError);
  const redisClient = redis.createClient({ url: config.redisUrl, disableOfflineQueue: true, socket: { connectTimeout: 5000 } });
  redisClient.on('error', () => console.error(JSON.stringify({ event: 'redis_unavailable' })));
  const server = http.createServer((req, res) => app(req, res));
  const io = new Server(server, {
    cors: { origin: config.origins, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 16384,
    allowRequest: (req, callback) => callback(null, !req.headers.origin || config.origins.includes(req.headers.origin))
  });
  const auth = createAuth(pool, config.jwtSecret);
  const presence = new Presence();
  const chat = createChatService(createChatRepository(pool), presence);
  const accounts = createAccountsService(createAccountsRepository(pool), auth);
  const events = createChatEvents(io, auth, chat);
  const app = createApp({ pool, redisClient, auth, chat, accounts, events, origins: config.origins });
  const stopPresence = registerRealtime({ io, auth, chat, redisClient, presence, events });
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    stopPresence();
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    await new Promise(resolve => io.close(resolve));
    await pool.end();
    if (redisClient.isOpen) await redisClient.disconnect();
    clearTimeout(timeout);
  }
  process.once('SIGTERM', () => shutdown().catch(logError));
  process.once('SIGINT', () => shutdown().catch(logError));
  try {
    await pool.query('SELECT client_message_id FROM messages LIMIT 0');
    await pool.query('SELECT role, session_version, setup_token_hash, capacity FROM agents LIMIT 0');
    await pool.query('SELECT id FROM conversation_assignments LIMIT 0');
    redisClient.connect().catch(logError);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '0.0.0.0', resolve);
    });
    console.log(JSON.stringify({ event: 'server_started', port: config.port }));
  } catch (error) {
    await shutdown();
    if (['42703', '42P01'].includes(error.code)) throw new Error('Run npm run db:migrate from the backend directory before starting the server.');
    throw error;
  }
}

if (require.main === module) start().catch(error => {
  console.error(JSON.stringify({ event: 'startup_failed', message: error.code ? 'Check database connectivity and configuration.' : error.message }));
  process.exitCode = 1;
});

module.exports = { start };
