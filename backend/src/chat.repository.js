const { transaction } = require('./database');

function createChatRepository(pool) {
  return {
    transaction: work => transaction(pool, work),
    async staff(id, client = pool, lock = false) {
      return (await client.query(`SELECT id, role, is_active, capacity, session_version, setup_token_hash FROM agents WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
    },
    async workload(client, id) {
      return (await client.query("SELECT count(*)::int AS count FROM conversations WHERE agent_id = $1 AND status = 'open'", [id])).rows[0].count;
    },
    async assign(client, id, agentId) {
      await client.query('UPDATE conversations SET agent_id = $2, updated_at = clock_timestamp() WHERE id = $1', [id, agentId]);
      await client.query("INSERT INTO conversation_assignments (conversation_id, agent_id, action) VALUES ($1, $2, 'accepted')", [id, agentId]);
    },
    async visibleVisitors(context, ids) {
      return (await pool.query(`SELECT DISTINCT visitor_id FROM conversations WHERE visitor_id = ANY($1::uuid[])
        AND ($2 = 'super_admin' OR agent_id = $3 OR (agent_id IS NULL AND status = 'open'))`, [ids, context.role, context.id])).rows.map(row => row.visitor_id);
    },
    async createVisitor(client, visitorId, address) {
      const result = await client.query('INSERT INTO visitors (visitor_id, ip_address) VALUES ($1, $2) RETURNING id', [visitorId, address]);
      return result.rows[0].id;
    },
    async lockVisitor(client, id) {
      const result = await client.query('SELECT id FROM visitors WHERE id = $1 FOR UPDATE', [id]);
      return result.rows[0];
    },
    async openConversation(client, visitorId) {
      let result = await client.query("SELECT id FROM conversations WHERE visitor_id = $1 AND status = 'open' ORDER BY created_at DESC, id DESC LIMIT 1", [visitorId]);
      if (!result.rows.length) result = await client.query('INSERT INTO conversations (visitor_id) VALUES ($1) RETURNING id', [visitorId]);
      await client.query('UPDATE visitors SET last_seen = NOW() WHERE id = $1', [visitorId]);
      return result.rows[0].id;
    },
    async conversation(id, client = pool, lock = false) {
      const result = await client.query(`SELECT id, visitor_id, status, agent_id FROM conversations WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
      return result.rows[0];
    },
    async history(conversationId, { limit, after, before }, client = pool) {
      const cursor = after || before;
      if (cursor) {
        const result = await client.query('SELECT id FROM messages WHERE id = $1 AND conversation_id = $2', [cursor, conversationId]);
        if (!result.rows.length) return null;
      }
      const result = await client.query(`
        SELECT id, conversation_id, sender_type, content, created_at, client_message_id
        FROM messages WHERE conversation_id = $1
        ${cursor ? `AND (created_at, id) ${after ? '>' : '<'} (SELECT created_at, id FROM messages WHERE id = $2 AND conversation_id = $1)` : ''}
        ORDER BY created_at ${after ? 'ASC' : 'DESC'}, id ${after ? 'ASC' : 'DESC'} LIMIT $${cursor ? 3 : 2}
      `, cursor ? [conversationId, cursor, limit + 1] : [conversationId, limit + 1]);
      const hasMore = result.rows.length > limit;
      const messages = result.rows.slice(0, limit);
      if (!after) messages.reverse();
      return { messages, hasMore };
    },
    async list(context, { limit, before, view }, client = pool) {
      const queue = view === 'queue';
      const filter = queue ? "c.agent_id IS NULL AND c.status = 'open'" : view === 'mine' ? 'c.agent_id = $3' : 'TRUE';
      const result = await client.query(`
        SELECT c.id, c.status, c.created_at, c.updated_at, c.agent_id, a.name AS agent_name, v.visitor_id, v.id AS visitor_identity_id,
          ${queue && context.role !== 'super_admin' ? 'NULL::text AS ip_address, NULL::text AS location, NULL::text AS last_message' : `v.ip_address, v.location,
          (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message`}
        FROM conversations c JOIN visitors v ON c.visitor_id = v.id
        LEFT JOIN agents a ON a.id = c.agent_id
        WHERE ${filter} AND ($3::uuid IS NOT NULL)
        AND ($2::uuid IS NULL OR (c.created_at, c.id) < (SELECT created_at, id FROM conversations WHERE id = $2))
        ORDER BY c.created_at DESC, c.id DESC LIMIT $1
      `, [limit + 1, before, context.id]);
      return { conversations: result.rows.slice(0, limit), hasMore: result.rows.length > limit };
    },
    async insertMessage(client, data) {
      const result = await client.query(`
        INSERT INTO messages (conversation_id, sender_type, sender_id, content, message_type, client_message_id, created_at)
        VALUES ($1, $2, $3, $4, 'text', $5, clock_timestamp()) ON CONFLICT DO NOTHING
        RETURNING id, conversation_id, sender_type, content, created_at, client_message_id
      `, [data.conversationId, data.senderType, data.senderId, data.content, data.clientMessageId]);
      return result.rows[0];
    },
    async existingMessage(client, data) {
      const result = await client.query(`
        SELECT id, conversation_id, sender_type, content, created_at, client_message_id FROM messages
        WHERE conversation_id = $1 AND sender_type = $2 AND sender_id = $3 AND client_message_id = $4
      `, [data.conversationId, data.senderType, data.senderId, data.clientMessageId]);
      return result.rows[0];
    },
    async knowledgeReply(client, content) {
      const result = await client.query(`
        SELECT response FROM knowledge_base
        WHERE (is_exact = TRUE AND LOWER(keyword) = LOWER($1))
           OR (is_exact = FALSE AND POSITION(LOWER(keyword) IN LOWER($1)) > 0)
        ORDER BY is_exact DESC, created_at, id LIMIT 1
      `, [content]);
      return result.rows[0]?.response;
    },
    async touch(client, id) {
      await client.query('UPDATE conversations SET updated_at = clock_timestamp() WHERE id = $1', [id]);
    },
    async resolve(client, id) {
      await client.query("UPDATE conversations SET status = 'resolved', resolved_at = NOW(), updated_at = NOW() WHERE id = $1", [id]);
    }
  };
}

module.exports = { createChatRepository };
