const { randomUUID } = require('node:crypto');
const { AppError } = require('./errors');
const { object, text, uuid, page } = require('./validation');

function createChatService(repository, presence) {
  async function staff(context, client, lock = false) {
    if (!['agent', 'super_admin'].includes(context?.role)) throw new AppError(403, 'FORBIDDEN', 'Staff access required.');
    const current = await repository.staff(context.id, client, lock);
    if (!current?.is_active || current.setup_token_hash || current.role !== context.role || current.session_version !== context.version) throw new AppError(401, 'UNAUTHORIZED', 'Please sign in again.');
    return current;
  }
  async function authorize(context, conversationId, client, lock = false) {
    if (!context) throw new AppError(401, 'UNAUTHORIZED', 'Join the chat first.');
    if (context.role !== 'visitor') await staff(context, client, lock);
    const conversation = await repository.conversation(conversationId, client, lock);
    if (!conversation || (context.role === 'visitor' ? conversation.visitor_id !== context.id : context.role !== 'super_admin' && conversation.agent_id !== context.id)) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found.');
    }
    return conversation;
  }

  return {
    authorize,
    async visibleVisitors(context, ids) { await staff(context); return repository.visibleVisitors(context, ids); },
    joinVisitor: (context, address) => repository.transaction(async client => {
      let id = context?.id;
      if (id) {
        if (!await repository.lockVisitor(client, id)) throw new AppError(401, 'UNAUTHORIZED', 'Visitor session is unavailable.');
      } else {
        id = await repository.createVisitor(client, `vis_${randomUUID()}`, address);
      }
      return { visitorId: id, conversationId: await repository.openConversation(client, id) };
    }),
    async history(context, conversationId, query) {
      uuid(conversationId, 'conversationId');
      return repository.transaction(async client => {
        await authorize(context, conversationId, client, true);
        const result = await repository.history(conversationId, page(query), client);
        if (!result) throw new AppError(400, 'INVALID_CURSOR', 'History cursor does not belong to this conversation.');
        return result;
      });
    },
    async list(context, query = {}) {
      const options = page(query);
      if (options.after) throw new AppError(400, 'INVALID_INPUT', 'Conversation lists use a before cursor.');
      const view = query.view || (context?.role === 'super_admin' ? 'all' : 'mine');
      return repository.transaction(async client => {
        await staff(context, client, true);
        if (!['queue', 'mine', 'all'].includes(view) || (view === 'all' && context.role !== 'super_admin')) throw new AppError(403, 'FORBIDDEN', 'This inbox is not available.');
        if (options.before) {
          const cursor = await repository.conversation(options.before, client);
          if (!cursor || (view === 'mine' && cursor.agent_id !== context.id) || (view === 'queue' && (cursor.agent_id || cursor.status !== 'open'))) throw new AppError(400, 'INVALID_CURSOR', 'Refresh this inbox before loading more.');
        }
        return repository.list(context, { ...options, view }, client);
      });
    },
    async accept(context, conversationId) {
      uuid(conversationId, 'conversationId');
      if (context?.role !== 'agent') throw new AppError(403, 'FORBIDDEN', 'Only agents accept queued chats.');
      return repository.transaction(async client => {
        // All capacity-changing operations lock the agent before the conversation.
        const agent = await staff(context, client, true);
        const conversation = await repository.conversation(conversationId, client, true);
        if (!conversation || conversation.status !== 'open') throw new AppError(409, 'CHAT_UNAVAILABLE', 'This chat is no longer waiting.');
        if (conversation.agent_id === context.id) return { id: conversationId };
        if (conversation.agent_id) throw new AppError(409, 'ALREADY_ACCEPTED', 'Another agent already accepted this chat.');
        if (await repository.workload(client, context.id) >= agent.capacity) throw new AppError(409, 'AT_CAPACITY', 'Resolve an active chat before accepting another.');
        if (!presence?.isOnline(context.id)) throw new AppError(409, 'AGENT_OFFLINE', 'Connect and set your availability to Online before accepting.');
        await repository.assign(client, conversationId, context.id);
        return { id: conversationId };
      });
    },
    async send(context, payload) {
      const input = object(payload);
      const data = {
        conversationId: uuid(input.conversationId, 'conversationId'),
        clientMessageId: uuid(input.clientMessageId, 'clientMessageId'),
        content: text(input.content, 'content').trim(),
        senderType: context?.role === 'super_admin' ? 'agent' : context?.role,
        senderId: context?.id
      };
      return repository.transaction(async client => {
        const conversation = await authorize(context, data.conversationId, client, true);
        // Resolve uncertain acknowledgements even if the conversation was since resolved.
        const existing = await repository.existingMessage(client, data);
        if (existing) {
          if (existing.content !== data.content) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This message ID was already used for different content.');
          return { message: existing, messages: [existing] };
        }
        if (conversation.status !== 'open') throw new AppError(409, 'CONVERSATION_RESOLVED', 'This conversation is resolved. Start a new chat to continue.');
        const message = await repository.insertMessage(client, data);
        const messages = [message];
        if (context.role === 'visitor') {
          const reply = await repository.knowledgeReply(client, data.content);
          if (reply) messages.push(await repository.insertMessage(client, { ...data, senderType: 'system', senderId: 'kb', content: reply, clientMessageId: null }));
        }
        await repository.touch(client, data.conversationId);
        return { message, messages };
      });
    },
    async resolve(context, conversationId) {
      uuid(conversationId, 'conversationId');
      if (!['agent', 'super_admin'].includes(context?.role)) throw new AppError(403, 'FORBIDDEN', 'Staff access required.');
      await repository.transaction(async client => {
        await authorize(context, conversationId, client, true);
        await repository.resolve(client, conversationId);
      });
    }
  };
}

module.exports = { createChatService };
