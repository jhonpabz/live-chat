require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { parseArgs } = require('node:util');
const { createAccountsRepository } = require('../src/accounts.repository');
const { createAccountsService } = require('../src/accounts.service');

async function main() {
  const { values } = parseArgs({ options: { name: { type: 'string' }, email: { type: 'string' }, reissue: { type: 'boolean', default: false } } });
  if (!process.env.DATABASE_URL) throw new Error('Configure backend/.env first.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    const accounts = createAccountsService(createAccountsRepository(pool));
    const result = values.reissue ? await accounts.reissueBootstrap(values.email) : await accounts.bootstrap({ name: values.name, email: values.email });
    console.log('Super-admin setup is ready. Open this path on your frontend host to choose a password:');
    console.log(`/set-password#token=${result.setupToken}`);
    console.log(`Expires: ${result.expiresAt}. Keep this one-time credential private.`);
  } finally { await pool.end(); }
}
main().catch(error => {
  console.error(error.status || !error.code ? error.message : 'Setup failed. Check migrations, connectivity, and whether the email is already in use.');
  process.exitCode = 1;
});
