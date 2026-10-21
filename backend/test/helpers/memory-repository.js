const { randomUUID } = require('node:crypto');

// In-memory persistence for service/socket tests. PostgreSQL behavior is tested
// separately; this fixture never opens the developer's configured database.
function memoryRepository() {
  const visitors = new Set();
  const conversations = new Map();
  const messages = [];
  const agents = new Map();
  let queue = Promise.resolve();
  let sequence = 0;
  const repository = {
    visitors, conversations, messages, agents, failWrites: false,
    async staff(id) { return agents.get(id); },
    async workload(_client, id) { return [...conversations.values()].filter(row => row.agent_id === id && row.status === 'open').length; },
    async assign(_client, id, agentId) { conversations.get(id).agent_id = agentId; },
    async visibleVisitors(context, ids) { return ids.filter(id => [...conversations.values()].some(row => row.visitor_id === id && (context.role === 'super_admin' || row.agent_id === context.id || (!row.agent_id && row.status === 'open')))); },
    transaction(work) {
      const transaction = queue.then(async () => {
        const snapshot = { visitors: new Set(visitors), conversations: new Map([...conversations].map(([id, value]) => [id, { ...value }])), messages: [...messages] };
        try { return await work({}); }
        catch (error) {
          visitors.clear(); for (const id of snapshot.visitors) visitors.add(id);
          conversations.clear(); for (const [id, value] of snapshot.conversations) conversations.set(id, value);
          messages.splice(0, messages.length, ...snapshot.messages);
          throw error;
        }
      });
      queue = transaction.catch(() => {});
      return transaction;
    },
    async createVisitor() { const id = randomUUID(); visitors.add(id); return id; },
    async lockVisitor(_client, id) { return visitors.has(id) ? { id } : undefined; },
    async openConversation(_client, visitorId) {
      const current = [...conversations.values()].find(value => value.visitor_id === visitorId && value.status === 'open');
      if (current) return current.id;
      const id = randomUUID();
      conversations.set(id, { id, visitor_id: visitorId, agent_id: null, status: 'open', updated_at: new Date().toISOString(), created_at: new Date().toISOString() });
      return id;
    },
    async conversation(id) { return conversations.get(id); },
    async existingMessage(_client, data) {
      return messages.find(value => value.conversation_id === data.conversationId && value.sender_type === data.senderType && value.sender_id === data.senderId && value.client_message_id === data.clientMessageId);
    },
    async insertMessage(_client, data) {
      if (repository.failWrites) throw new Error('Simulated storage failure');
      const message = { id: randomUUID(), conversation_id: data.conversationId, sender_type: data.senderType, sender_id: data.senderId, content: data.content, client_message_id: data.clientMessageId, created_at: new Date(1700000000000 + sequence++).toISOString() };
      messages.push(message);
      return message;
    },
    async knowledgeReply(_client, content) { return content === 'help' ? 'How can we help?' : undefined; },
    async touch() {},
    async resolve(_client, id) { conversations.get(id).status = 'resolved'; },
    async history(conversationId, { limit, after, before }) {
      const all = messages.filter(value => value.conversation_id === conversationId);
      const cursor = after || before;
      const index = all.findIndex(value => value.id === cursor);
      if (cursor && index < 0) return null;
      const selected = after ? all.slice(index + 1) : before ? all.slice(0, index) : all;
      return { messages: after ? selected.slice(0, limit) : selected.slice(-limit), hasMore: selected.length > limit };
    },
    async list(context, { limit, view }) {
      const rows = [...conversations.values()].filter(row => view === 'all' || (view === 'queue' ? !row.agent_id && row.status === 'open' : row.agent_id === context.id));
      return { conversations: rows.slice(0, limit), hasMore: rows.length > limit };
    }
  };
  return repository;
}

module.exports = { memoryRepository };
