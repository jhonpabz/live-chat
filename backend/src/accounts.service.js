const { randomBytes, createHash } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { AppError } = require('./errors');
const { object, text, email, password, capacity, uuid, page } = require('./validation');

function requireAdmin(context) {
  if (context?.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Super-admin access required.');
}
function setupCredential() {
  const token = randomBytes(32).toString('hex');
  return { token, hash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
}
function accountInput(payload) {
  const input = object(payload);
  if (input.role !== undefined || input.is_active !== undefined) throw new AppError(400, 'INVALID_INPUT', 'Role and status cannot be set here.');
  return { name: text(input.name, 'name', 255).trim(), email: email(input.email), capacity: capacity(input.capacity) };
}
function createAccountsService(repository, auth) {
  async function safe(work) {
    try { return await work(); }
    catch (error) {
      if (error.code === '23505') throw new AppError(409, 'EMAIL_EXISTS', 'An account already uses this email address.');
      throw error;
    }
  }
  async function lockAdmin(client, context) {
    requireAdmin(context);
    const current = await repository.lock(client, context.id);
    if (!current?.is_active || current.role !== 'super_admin' || current.setup_token_hash || current.session_version !== context.version) throw new AppError(401, 'UNAUTHORIZED', 'Please sign in again.');
  }
  async function target(client, id) {
    const row = await repository.lock(client, uuid(id));
    if (!row || row.role !== 'agent') throw new AppError(404, 'NOT_FOUND', 'Agent not found.');
    return row;
  }
  async function create(payload, context, bootstrap = false) {
    if (!bootstrap) requireAdmin(context);
    const data = accountInput(payload);
    const credential = setupCredential();
    const unusablePassword = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
    const agent = await safe(() => repository.transaction(async client => {
      if (bootstrap) {
        if (await repository.bootstrapLock(client)) throw new AppError(409, 'ALREADY_PROVISIONED', 'A super admin already exists. Initial setup is closed.');
      } else await lockAdmin(client, context);
      const id = await repository.insert(client, data, bootstrap ? 'super_admin' : 'agent', credential.hash, credential.expiresAt, unusablePassword);
      return repository.profile(id, client);
    }));
    return { agent, setupToken: credential.token, expiresAt: credential.expiresAt };
  }
  return {
    bootstrap: payload => create(payload, null, true),
    async reissueBootstrap(address) {
      const credential = setupCredential();
      await repository.transaction(async client => {
        await repository.bootstrapLock(client);
        const pending = await repository.pendingBootstrap(client, email(address));
        if (!pending) throw new AppError(409, 'SETUP_CLOSED', 'Only an unfinished initial super-admin setup can be reissued.');
        await repository.reset(client, pending.id, credential.hash, credential.expiresAt);
      });
      return { setupToken: credential.token, expiresAt: credential.expiresAt };
    },
    create: (context, payload) => create(payload, context),
    async login(payload) {
      const input = object(payload);
      const row = await repository.findByEmail(email(input.email));
      const valid = await bcrypt.compare(text(input.password, 'password', 200), row?.password_hash || '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
      if (!row?.is_active || row.setup_token_hash || !valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials or account unavailable.');
      return { token: auth.agentToken(row), agent: await repository.profile(row.id) };
    },
    me: context => repository.profile(context.id),
    list(context, query) {
      requireAdmin(context);
      const options = page(query);
      if (options.after) throw new AppError(400, 'INVALID_INPUT', 'Use a before cursor.');
      return repository.list(options);
    },
    edit(context, id, payload) {
      requireAdmin(context);
      const data = accountInput(payload);
      return safe(() => repository.transaction(async client => {
        await lockAdmin(client, context);
        await target(client, id);
        const profile = await repository.profile(id, client);
        if (data.capacity < profile.active_chats) throw new AppError(409, 'CAPACITY_IN_USE', 'Resolve active chats before lowering capacity below the current workload.');
        await repository.edit(client, id, data);
        return repository.profile(id, client);
      }));
    },
    setActive(context, id, payload) {
      requireAdmin(context);
      const input = object(payload);
      if (typeof input.active !== 'boolean') throw new AppError(400, 'INVALID_INPUT', 'active must be a boolean.');
      return repository.transaction(async client => {
        await lockAdmin(client, context);
        const row = await target(client, id);
        if (row.is_active !== input.active) await repository.setActive(client, id, input.active);
        return repository.profile(id, client);
      });
    },
    async reset(context, id) {
      requireAdmin(context);
      const credential = setupCredential();
      await repository.transaction(async client => {
        await lockAdmin(client, context);
        const row = await target(client, id);
        if (!row.is_active) throw new AppError(409, 'ACCOUNT_DISABLED', 'Reactivate the agent before issuing a setup link.');
        await repository.reset(client, id, credential.hash, credential.expiresAt);
      });
      return { setupToken: credential.token, expiresAt: credential.expiresAt };
    },
    async completeSetup(payload) {
      const input = object(payload);
      if (typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)) throw new AppError(400, 'INVALID_SETUP_TOKEN', 'This setup link is invalid or expired.');
      const passwordHash = await bcrypt.hash(password(input.password), 12);
      const hash = createHash('sha256').update(input.token).digest('hex');
      const row = await repository.transaction(client => repository.completeSetup(client, hash, passwordHash));
      if (!row) throw new AppError(400, 'INVALID_SETUP_TOKEN', 'This setup link is invalid or expired.');
      return row.id;
    }
  };
}
module.exports = { createAccountsService, requireAdmin };
