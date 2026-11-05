import dotenv from 'dotenv';
import { join } from 'node:path';
import { backendRoot } from '../src/paths';
import { errorCode } from '../src/errors';
import { Pool } from 'pg';
import { parseArgs } from 'node:util';
import { createAccountsRepository } from '../src/accounts.repository';
import { createAccountsService } from '../src/accounts.service';

dotenv.config({ path: join(backendRoot, '.env') });

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
main().catch((error: unknown) => {
  console.error((error instanceof Error && "status" in error) || !errorCode(error) ? (error instanceof Error ? error.message : 'Unexpected failure.') : 'Setup failed. Check migrations, connectivity, and whether the email is already in use.');
  process.exitCode = 1;
});
