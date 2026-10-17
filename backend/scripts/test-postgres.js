require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');

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
      cwd: require('node:path').join(__dirname, '..'),
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

run().catch(error => {
  console.error(`Isolated PostgreSQL tests could not run (${error.code || 'configuration error'}). Check that local PostgreSQL is running and the configured user can create test databases.`);
  process.exitCode = 1;
});
