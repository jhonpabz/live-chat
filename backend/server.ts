import type { ChatServer } from './src/socket.types';
import dotenv from 'dotenv';
import { join } from 'node:path';
import { backendRoot } from './src/paths';
import { errorCode } from './src/errors';
import http from 'node:http';
import { Server } from 'socket.io';
import { Pool, types } from 'pg';
import { createClient } from 'redis';
import { loadConfig } from './src/config';
import { createAuth } from './src/auth';
import { createChatRepository } from './src/chat.repository';
import { createChatService } from './src/chat.service';
import { createApp } from './src/app';
import { registerRealtime } from './src/realtime';
import { logError } from './src/errors';
import { Presence } from './src/presence';
import { createChatEvents } from './src/chat.events';
import { createAccountsRepository } from './src/accounts.repository';
import { createAccountsService } from './src/accounts.service';

dotenv.config({ path: join(backendRoot, '.env') });

async function start() {
  const config = loadConfig();
  // The existing schema uses timestamps without a timezone. Interpret them as UTC.
  types.setTypeParser(1114, value => {
    const [seconds, fraction = ''] = value.replace(' ', 'T').split('.');
    return `${seconds}.${fraction.padEnd(6, '0')}Z`;
  });
  const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, options: '-c timezone=UTC -c statement_timeout=10000' });
  pool.on('error', logError);
  const redisClient = createClient({ url: config.redisUrl, disableOfflineQueue: true, socket: { connectTimeout: 5000 } });
  redisClient.on('error', () => console.error(JSON.stringify({ event: 'redis_unavailable' })));
  const server = http.createServer((req, res) => app(req, res));
  const io: ChatServer = new Server(server, {
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
    await new Promise<void>(resolve => io.close(() => resolve()));
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
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '0.0.0.0', resolve);
    });
    console.log(JSON.stringify({ event: 'server_started', port: config.port }));
  } catch (error) {
    await shutdown();
    if (['42703', '42P01'].includes(errorCode(error) || '')) throw new Error('Run npm run db:migrate from the backend directory before starting the server.');
    throw error;
  }
}

if (require.main === module) start().catch((error: unknown) => {
  console.error(JSON.stringify({ event: 'startup_failed', message: errorCode(error) ? 'Check database connectivity and configuration.' : (error instanceof Error ? error.message : 'Unexpected failure.') }));
  process.exitCode = 1;
});

export { start };
