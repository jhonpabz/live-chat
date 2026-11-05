import type { Auth } from './auth';
import type { ChatService } from './chat.service';
import type { ChatServer, PublishedEvent, ServerEvents } from './socket.types';
import { AppError, logError } from './errors';

type Publication = { [E in PublishedEvent]: [event: E, payload: Parameters<ServerEvents[E]>[0], excludeSocket?: string] }[PublishedEvent];

function createChatEvents(io: ChatServer, auth: Auth, chat: ChatService) {
  return {
    // Invalidation contains no conversation IDs or private content.
    changed() { io.to('staff').emit('conversation_update', {}); },
    presenceChanged() { io.to('staff').emit('presence_changed'); },
    revoke(id: string) {
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.identity?.role !== 'visitor' && socket.data.identity?.id === id) {
          socket.emit('session_expired');
          socket.disconnect(true);
        }
      }
      io.to('staff').emit('conversation_update', {});
    },
    async publish(conversationId: string, ...publication: Publication) {
      const [event, payload, excludeSocket] = publication;
      const room = io.to(`conversation:${conversationId}`).except(excludeSocket || '');
      if (event === 'new_message') room.emit(event, payload);
      else if (event === 'typing') room.emit(event, payload);
      else room.emit(event, payload);
      // Reauthorize at delivery; membership in a staff room never grants history access.
      for (const socket of io.sockets.sockets.values()) {
        if (!socket.data.identity || socket.data.identity.role === 'visitor' || socket.id === excludeSocket) continue;
        try {
          const identity = await auth.agent(socket.handshake.auth.token);
          await chat.authorize(identity, conversationId);
          if (socket.connected) {
            if (event === 'new_message') socket.emit(event, payload);
            else if (event === 'typing') socket.emit(event, payload);
            else socket.emit(event, payload);
          }
        } catch (error) {
          if (error instanceof AppError && error.status === 401) { socket.emit('session_expired'); socket.disconnect(true); }
          else if (!(error instanceof AppError) || error.status !== 404) logError(error);
        }
      }
    }
  };
}
export { createChatEvents };
export type ChatEvents = ReturnType<typeof createChatEvents>;
