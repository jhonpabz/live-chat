const { randomUUID } = require('node:crypto');
const { AppError } = require('./errors');
const { object, text, uuid, page } = require('./validation');

function createChatService(repository) {
  async function authorize(context, conversationId, client, lock = false) {
    if (!context) throw new AppError(401, 'UNAUTHORIZED', 'Join the chat first.');
    const conversation = await repository.conversation(conversationId, client, lock);
    // This application has one shared inbox: every verified agent can access it.
    if (!conversation || (context.role !== 'agent' && conversation.visitor_id !== context.id)) {
      throw new AppError(404, 'NOT_FOUND', 'Conversation not found.');
    }
    return conversation;
  }

  return {
    authorize,
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
      await authorize(context, conversationId);
      const result = await repository.history(conversationId, page(query));
      if (!result) throw new AppError(400, 'INVALID_CURSOR', 'History cursor does not belong to this conversation.');
      return result;
    },
    list(query) {
      const options = page(query);
      if (options.after) throw new AppError(400, 'INVALID_INPUT', 'Conversation lists use a before cursor.');
      return repository.list(options);
    },
    async send(context, payload) {
      const input = object(payload);
      const data = {
        conversationId: uuid(input.conversationId, 'conversationId'),
        clientMessageId: uuid(input.clientMessageId, 'clientMessageId'),
        content: text(input.content, 'content').trim(),
        senderType: context?.role,
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
      if (context?.role !== 'agent') throw new AppError(403, 'FORBIDDEN', 'Agent access required.');
      await repository.transaction(async client => {
        await authorize(context, conversationId, client, true);
        await repository.resolve(client, conversationId);
      });
    }
  };
}

module.exports = { createChatService };
