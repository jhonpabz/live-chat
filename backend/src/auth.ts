import jwt from 'jsonwebtoken';
import { AppError } from './errors';
import { uuid } from './validation';
import type { Pool } from 'pg';
import type { Account, Identity, StaffIdentity } from './types';

function createAuth(pool: Pool, secret: string) {
  function verify(token: unknown) {
    try {
      if (typeof token !== 'string') throw new Error();
      const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
      if (typeof claims !== 'object' || !claims || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) throw new Error();
      const id: unknown = claims.id;
      const role: unknown = claims.role;
      const version: unknown = claims.version;
      return { id, role, version, exp: claims.exp };
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
    }
  }

  async function agent(token: unknown): Promise<StaffIdentity> {
    const claims = verify(token);
    if ((claims.role !== 'agent' && claims.role !== 'super_admin') || !Number.isInteger(claims.version)) throw new AppError(401, 'UNAUTHORIZED', 'Please sign in again.');
    try { uuid(claims.id, 'agent id'); }
    catch { throw new AppError(401, 'UNAUTHORIZED', 'Agent authentication required.'); }
    const result = await pool.query<Account>('SELECT id, role, is_active, session_version, setup_token_hash FROM agents WHERE id = $1', [claims.id]);
    const account = result.rows[0];
    if (!account?.is_active || account.setup_token_hash || account.session_version !== claims.version || account.role !== claims.role) throw new AppError(401, 'UNAUTHORIZED', 'Account or session is unavailable. Please sign in again.');
    return { role: account.role, id: account.id, version: account.session_version, exp: claims.exp };
  }

  function visitor(token: unknown): Extract<Identity, { role: 'visitor' }> {
    const claims = verify(token);
    if (claims.role !== 'visitor') throw new AppError(401, 'UNAUTHORIZED', 'Visitor authentication required.');
    try { return { role: 'visitor', id: uuid(claims.id, 'visitor id'), exp: claims.exp }; }
    catch { throw new AppError(401, 'UNAUTHORIZED', 'Visitor authentication required.'); }
  }

  return {
    agent, visitor,
    agentToken: (user: Pick<Account, 'id' | 'role' | 'session_version'>) => jwt.sign({ id: user.id, role: user.role, version: user.session_version }, secret, { expiresIn: '7d' }),
    visitorToken: (id: string) => jwt.sign({ id, role: 'visitor' }, secret, { expiresIn: '30d' })
  };
}

export { createAuth };
export type Auth = ReturnType<typeof createAuth>;
