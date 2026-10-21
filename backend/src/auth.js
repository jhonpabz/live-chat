const jwt = require('jsonwebtoken');
const { AppError } = require('./errors');
const { uuid } = require('./validation');

function createAuth(pool, secret) {
  function verify(token) {
    try {
      const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
      if (typeof claims !== 'object' || !claims || !Number.isFinite(claims.exp)) throw new Error();
      return claims;
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
    }
  }

  async function agent(token) {
    const claims = verify(token);
    if (!['agent', 'super_admin'].includes(claims.role) || !Number.isInteger(claims.version)) throw new AppError(401, 'UNAUTHORIZED', 'Please sign in again.');
    try { uuid(claims.id, 'agent id'); }
    catch { throw new AppError(401, 'UNAUTHORIZED', 'Agent authentication required.'); }
    const result = await pool.query('SELECT id, role, is_active, session_version, setup_token_hash FROM agents WHERE id = $1', [claims.id]);
    const account = result.rows[0];
    if (!account?.is_active || account.setup_token_hash || account.session_version !== claims.version || account.role !== claims.role) throw new AppError(401, 'UNAUTHORIZED', 'Account or session is unavailable. Please sign in again.');
    return { role: account.role, id: account.id, version: account.session_version, exp: claims.exp };
  }

  function visitor(token) {
    const claims = verify(token);
    if (claims.role !== 'visitor') throw new AppError(401, 'UNAUTHORIZED', 'Visitor authentication required.');
    try { return { role: 'visitor', id: uuid(claims.id, 'visitor id'), exp: claims.exp }; }
    catch { throw new AppError(401, 'UNAUTHORIZED', 'Visitor authentication required.'); }
  }

  return {
    agent, visitor,
    agentToken: user => jwt.sign({ id: user.id, role: user.role, version: user.session_version }, secret, { expiresIn: '7d' }),
    visitorToken: id => jwt.sign({ id, role: 'visitor' }, secret, { expiresIn: '30d' })
  };
}

module.exports = { createAuth };
