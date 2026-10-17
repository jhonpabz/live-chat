const { AppError, publicError, logError } = require('./errors');
const { object, uuid } = require('./validation');
const { createRateLimit } = require('./rate-limit');
const { Presence } = require('./presence');

function registerRealtime({ io, auth, chat, redisClient }) {
  const presence = new Presence();
  const handshakeLimit = createRateLimit({ limit: 60, windowMs: 60000 });
  const eventLimit = createRateLimit({ limit: 180, windowMs: 60000 });
  const broadcastAvailability = () => io.emit('support_availability', presence.availability());
  let redisHealthy = true;

  async function renewPresence() {
    try {
      if (!redisClient.isReady) throw new Error();
      const batch = redisClient.multi();
      for (const [socketId, identity] of presence.connections) {
        batch.set(`livechat:presence:${socketId}`, JSON.stringify(identity), { EX: 45 });
      }
      if (presence.connections.size) await batch.exec();
      if (!redisHealthy) io.emit('service_state', { redis: true });
      redisHealthy = true;
    } catch {
      if (redisHealthy) {
        console.error(JSON.stringify({ event: 'presence_cache_unavailable' }));
        io.emit('service_state', { redis: false });
      }
      redisHealthy = false;
    }
  }

  io.use(async (socket, next) => {
    try {
      handshakeLimit(socket.handshake.address);
      const credentials = object(socket.handshake.auth);
      if (credentials.token !== undefined) socket.data.identity = await auth.agent(credentials.token);
      else if (credentials.visitorToken !== undefined) socket.data.identity = auth.visitor(credentials.visitorToken);
      next();
    } catch (error) {
      const failure = new Error(publicError(error).message);
      failure.data = publicError(error);
      next(failure);
    }
  });

  io.on('connection', socket => {
    let expiryTimer;
    let joining = false;
    function scheduleExpiry() {
      clearTimeout(expiryTimer);
      const identity = socket.data.identity;
      if (!identity) return;
      const remaining = identity.exp * 1000 - Date.now();
      // Node timers are signed 32-bit milliseconds; visitors may live for 30 days.
      expiryTimer = setTimeout(() => {
        if (Date.now() >= socket.data.identity.exp * 1000) {
          socket.emit('session_expired');
          socket.disconnect(true);
        } else scheduleExpiry();
      }, Math.max(1, Math.min(remaining, 2147483647)));
      expiryTimer.unref();
    }

    socket.use(async (packet, next) => {
      try {
        const identity = socket.data.identity;
        eventLimit(identity ? `${identity.role}:${identity.id}` : socket.handshake.address);
        if (identity && identity.exp * 1000 <= Date.now()) throw new AppError(401, 'UNAUTHORIZED', 'Your session has expired.');
        if (identity?.role === 'agent') await auth.agent(socket.handshake.auth.token);
        next();
      } catch (error) {
        const acknowledge = packet[packet.length - 1];
        if (typeof acknowledge === 'function') acknowledge({ ok: false, error: publicError(error) });
        socket.emit('request_error', publicError(error));
        if (error.status === 401) socket.disconnect(true);
        next(error);
      }
    });
    socket.on('error', error => {
      if (!(error instanceof AppError)) logError(error);
    });

    function handle(event, work) {
      socket.on(event, async (payload, acknowledge) => {
        try {
          const data = await work(payload);
          if (typeof acknowledge === 'function') acknowledge({ ok: true, data });
        } catch (error) {
          if (!(error instanceof AppError)) logError(error);
          const failure = { ok: false, error: publicError(error) };
          if (typeof acknowledge === 'function') acknowledge(failure);
          else socket.emit('request_error', failure.error);
        }
      });
    }

    socket.emit('support_availability', presence.availability());
    socket.emit('service_state', { redis: redisClient.isReady });
    if (socket.data.identity?.role === 'agent') {
      socket.join('agents');
      const status = presence.connect(socket.id, socket.data.identity, socket.handshake.auth.status);
      socket.emit('agent_status_current', status);
      broadcastAvailability();
    }
    scheduleExpiry();

    handle('agent_status', status => {
      const identity = socket.data.identity;
      if (identity?.role !== 'agent') throw new AppError(403, 'FORBIDDEN', 'Agent access required.');
      if (!['online', 'offline'].includes(status)) throw new AppError(400, 'INVALID_INPUT', 'Choose online or offline.');
      for (const socketId of presence.setStatus(identity.id, status)) io.to(socketId).emit('agent_status_current', status);
      broadcastAvailability();
      return { status };
    });

    handle('visitor_join', async payload => {
      object(payload);
      if (socket.data.identity?.role === 'agent') throw new AppError(403, 'FORBIDDEN', 'Use the agent inbox.');
      if (joining) throw new AppError(409, 'JOIN_IN_PROGRESS', 'Chat is already connecting.');
      joining = true;
      try {
        const joined = await chat.joinVisitor(socket.data.identity, socket.handshake.address);
        const visitorToken = auth.visitorToken(joined.visitorId);
        socket.data.identity = auth.visitor(visitorToken);
        if (!socket.connected) return;
        for (const room of socket.rooms) if (room.startsWith('conversation:')) socket.leave(room);
        socket.join(`conversation:${joined.conversationId}`);
        presence.connect(socket.id, socket.data.identity);
        scheduleExpiry();
        io.to('agents').emit('visitor_online', { visitorId: joined.visitorId });
        io.to('agents').emit('conversation_update', { conversationId: joined.conversationId });
        const data = { conversationId: joined.conversationId, visitorToken };
        socket.emit('conversation_ready', data);
        return data;
      } finally {
        joining = false;
      }
    });

    handle('message_history', payload => {
      const input = object(payload);
      return chat.history(socket.data.identity, input.conversationId, input);
    });

    handle('send_message', async payload => {
      const result = await chat.send(socket.data.identity, payload);
      for (const message of result.messages) io.to(`conversation:${message.conversation_id}`).to('agents').emit('new_message', message);
      io.to('agents').emit('conversation_update', { conversationId: result.message.conversation_id });
      return result.message;
    });

    let lastTypingAt = 0;
    handle('typing', async payload => {
      const input = object(payload);
      const conversationId = uuid(input.conversationId, 'conversationId');
      if (typeof input.isTyping !== 'boolean') throw new AppError(400, 'INVALID_INPUT', 'isTyping must be a boolean.');
      await chat.authorize(socket.data.identity, conversationId);
      if (Date.now() - lastTypingAt < 500) return {};
      lastTypingAt = Date.now();
      socket.to(`conversation:${conversationId}`).to('agents').emit('typing', { conversationId, isTyping: input.isTyping, isAgent: socket.data.identity.role === 'agent' });
      return {};
    });

    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      const disconnected = presence.disconnect(socket.id);
      broadcastAvailability();
      if (disconnected?.role === 'visitor') io.to('agents').emit('visitor_offline', { visitorId: disconnected.id });
      if (redisClient.isReady) redisClient.del(`livechat:presence:${socket.id}`).catch(logError);
    });
  });

  const heartbeat = setInterval(renewPresence, 15000);
  heartbeat.unref();
  return () => clearInterval(heartbeat);
}

module.exports = { registerRealtime };
