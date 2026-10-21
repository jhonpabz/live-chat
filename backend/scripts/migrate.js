require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { Client } = require('pg');

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
    for (const file of readdirSync(join(__dirname, '..', 'migrations')).filter(file => /^\d+_.+\.sql$/.test(file)).sort()) {
      await client.query(readFileSync(join(__dirname, '..', 'migrations', file), 'utf8'));
      console.log(`Applied ${file}.`);
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) migrate().catch(error => {
  console.error(error.code ? `Migration failed (${error.code}). Check database connectivity, permissions, and schema.` : error.message);
  process.exitCode = 1;
});

module.exports = { migrate };
