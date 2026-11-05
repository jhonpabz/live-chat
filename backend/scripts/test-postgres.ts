import dotenv from 'dotenv';
import { join } from 'node:path';
import { backendRoot } from '../src/paths';
import { errorCode } from '../src/errors';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';

dotenv.config({ path: join(backendRoot, '.env') });

async function run() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Database integration tests require a local PostgreSQL server. The application database is never used.');
  }
  const database = `livechat_test_${randomBytes(8).toString('hex')}`;
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new Pool({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
  let created = false;
  try {
    // The identifier contains only a fixed prefix and random hexadecimal digits.
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    url.pathname = `/${database}`;
    const child = spawn(process.execPath, ['--test', 'test/postgres.integration.js'], {
      cwd: backendRoot,
      env: { ...process.env, LIVECHAT_ISOLATED_DATABASE_URL: url.toString() },
      stdio: 'inherit', windowsHide: true
    });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    process.exitCode = code === 0 ? 0 : 1;
  } finally {
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
}

run().catch((error: unknown) => {
  console.error(`Isolated PostgreSQL tests could not run (${errorCode(error) || 'configuration error'}). Check that local PostgreSQL is running and the configured user can create test databases.`);
  process.exitCode = 1;
});
