const { logError } = require('./errors');

function createChatEvents(io, auth, chat) {
  return {
    // Invalidation contains no conversation IDs or private content.
    changed() { io.to('staff').emit('conversation_update', {}); },
    presenceChanged() { io.to('staff').emit('presence_changed'); },
    revoke(id) {
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.identity?.role !== 'visitor' && socket.data.identity?.id === id) {
          socket.emit('session_expired');
          socket.disconnect(true);
        }
      }
      io.to('staff').emit('conversation_update', {});
    },
    async publish(conversationId, event, payload, excludeSocket) {
      io.to(`conversation:${conversationId}`).except(excludeSocket || '').emit(event, payload);
      // Reauthorize at delivery; membership in a staff room never grants history access.
      for (const socket of io.sockets.sockets.values()) {
        if (!socket.data.identity || socket.data.identity.role === 'visitor' || socket.id === excludeSocket) continue;
        try {
          const identity = await auth.agent(socket.handshake.auth.token);
          await chat.authorize(identity, conversationId);
          if (socket.connected) socket.emit(event, payload);
        } catch (error) {
          if (error.status === 401) { socket.emit('session_expired'); socket.disconnect(true); }
          else if (error.status !== 404) logError(error);
        }
      }
    }
  };
}
module.exports = { createChatEvents };
