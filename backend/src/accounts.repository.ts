import type { Pool, PoolClient } from 'pg';
import type { Database, Account, AccountProfile, AccountInput, StaffRole, Page } from './types';
import { transaction } from './database';

const publicFields = 'a.id, a.name, a.email, a.role, a.is_active, a.capacity, (a.setup_token_hash IS NOT NULL) AS pending_setup';
function createAccountsRepository(pool: Pool) {
  return {
    transaction: <T>(work: (client: PoolClient) => Promise<T>) => transaction(pool, work),
    async findByEmail(email: string) { return (await pool.query<Account>('SELECT * FROM agents WHERE lower(btrim(email)) = $1', [email])).rows[0]; },
    async lock(client: PoolClient, id: string) { return (await client.query<Account>('SELECT * FROM agents WHERE id = $1 FOR UPDATE', [id])).rows[0]; },
    async profile(id: string, client: Database = pool) {
      return (await client.query<AccountProfile>(`SELECT ${publicFields}, (SELECT count(*)::int FROM conversations WHERE agent_id = a.id AND status = 'open') AS active_chats FROM agents a WHERE a.id = $1`, [id])).rows[0];
    },
    async list({ limit, before }: Page) {
      const result = await pool.query<AccountProfile>(`SELECT ${publicFields}, (SELECT count(*)::int FROM conversations WHERE agent_id = a.id AND status = 'open') AS active_chats
        FROM agents a WHERE a.role = 'agent' AND ($2::uuid IS NULL OR a.id > $2) ORDER BY a.id LIMIT $1`, [limit + 1, before]);
      return { agents: result.rows.slice(0, limit), hasMore: result.rows.length > limit };
    },
    async bootstrapLock(client: PoolClient) {
      await client.query<Record<string, unknown>>('SELECT pg_advisory_xact_lock(180017, 2)');
      return (await client.query<{ id: string }>("SELECT id FROM agents WHERE role = 'super_admin' LIMIT 1")).rows.length > 0;
    },
    async pendingBootstrap(client: PoolClient, email: string) {
      return (await client.query<{ id: string }>("SELECT id FROM agents WHERE lower(btrim(email)) = $1 AND role = 'super_admin' AND setup_token_hash IS NOT NULL AND is_active = TRUE FOR UPDATE", [email])).rows[0];
    },
    async insert(client: PoolClient, data: AccountInput, role: StaffRole, hash: string, expires: string, unusablePassword: string) {
      return (await client.query<{ id: string }>(`INSERT INTO agents (name, email, role, capacity, password_hash, setup_token_hash, setup_expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [data.name, data.email, role, data.capacity, unusablePassword, hash, expires])).rows[0].id;
    },
    async edit(client: PoolClient, id: string, data: AccountInput) {
      await client.query<Record<string, unknown>>('UPDATE agents SET name = $2, email = $3, capacity = $4, updated_at = NOW() WHERE id = $1', [id, data.name, data.email, data.capacity]);
    },
    async setActive(client: PoolClient, id: string, active: boolean) {
      await client.query<Record<string, unknown>>('UPDATE agents SET is_active = $2, session_version = session_version + 1, updated_at = NOW() WHERE id = $1', [id, active]);
      if (!active) {
        // Retain assignment history before releasing active capacity and requeuing.
        await client.query<Record<string, unknown>>(`INSERT INTO conversation_assignments (conversation_id, agent_id, action)
          SELECT id, agent_id, 'deactivated' FROM conversations WHERE agent_id = $1 AND status = 'open'`, [id]);
        await client.query<Record<string, unknown>>("UPDATE conversations SET agent_id = NULL, updated_at = clock_timestamp() WHERE agent_id = $1 AND status = 'open'", [id]);
      }
    },
    async reset(client: PoolClient, id: string, hash: string, expires: string) {
      await client.query<Record<string, unknown>>('UPDATE agents SET setup_token_hash = $2, setup_expires_at = $3, session_version = session_version + 1, updated_at = NOW() WHERE id = $1', [id, hash, expires]);
    },
    async completeSetup(client: PoolClient, tokenHash: string, passwordHash: string) {
      return (await client.query<{ id: string }>(`UPDATE agents SET password_hash = $2, setup_token_hash = NULL, setup_expires_at = NULL,
        session_version = session_version + 1, updated_at = NOW()
        WHERE setup_token_hash = $1 AND setup_expires_at > NOW() AND is_active = TRUE RETURNING id`, [tokenHash, passwordHash])).rows[0];
    }
  };
}
export { createAccountsRepository };

export type AccountsRepository = ReturnType<typeof createAccountsRepository>;
