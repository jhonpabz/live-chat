import dotenv from 'dotenv';
import { join } from 'node:path';
import { backendRoot } from '../src/paths';
import { errorCode } from '../src/errors';
import { readFileSync, readdirSync } from 'node:fs';
import { Client } from 'pg';

dotenv.config({ path: join(backendRoot, '.env') });

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in backend/.env.');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    options: '-c lock_timeout=5000 -c statement_timeout=60000'
  });
  try {
    await client.connect();
    // Serialize explicit migration commands; the SQL itself is safe to rerun.
    await client.query('SELECT pg_advisory_lock(180017, 1)');
    for (const file of readdirSync(join(backendRoot, 'migrations')).filter(file => /^\d+_.+\.sql$/.test(file)).sort()) {
      await client.query(readFileSync(join(backendRoot, 'migrations', file), 'utf8'));
      console.log(`Applied ${file}.`);
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) migrate().catch((error: unknown) => {
  console.error(errorCode(error) ? `Migration failed (${errorCode(error)}). Check database connectivity, permissions, and schema.` : (error instanceof Error ? error.message : 'Unexpected failure.'));
  process.exitCode = 1;
});

export { migrate };
