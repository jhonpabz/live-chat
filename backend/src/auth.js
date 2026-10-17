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
    // Existing agent tokens have no role claim; visitor tokens always do.
    if (claims.role && claims.role !== 'agent') throw new AppError(401, 'UNAUTHORIZED', 'Agent authentication required.');
    try { uuid(claims.id, 'agent id'); }
    catch { throw new AppError(401, 'UNAUTHORIZED', 'Agent authentication required.'); }
    const result = await pool.query('SELECT id FROM agents WHERE id = $1', [claims.id]);
    if (!result.rows.length) throw new AppError(401, 'UNAUTHORIZED', 'Agent account is unavailable.');
    return { role: 'agent', id: claims.id, exp: claims.exp };
  }

  function visitor(token) {
    const claims = verify(token);
    if (claims.role !== 'visitor') throw new AppError(401, 'UNAUTHORIZED', 'Visitor authentication required.');
    try { return { role: 'visitor', id: uuid(claims.id, 'visitor id'), exp: claims.exp }; }
    catch { throw new AppError(401, 'UNAUTHORIZED', 'Visitor authentication required.'); }
  }

  return {
    agent, visitor,
    agentToken: user => jwt.sign({ id: user.id, email: user.email, name: user.name, role: 'agent' }, secret, { expiresIn: '7d' }),
    visitorToken: id => jwt.sign({ id, role: 'visitor' }, secret, { expiresIn: '30d' })
  };
}

module.exports = { createAuth };
