import { record, type ChatSocket, type Message, type TypingEvent } from '../../lib/contracts';

export function createTypingSession(socket: ChatSocket, conversationId: string, isAgent: boolean, setRemoteTyping: (active: boolean) => void) {
  let localActive = false;
  let lastSent = -Infinity;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let remoteTimer: ReturnType<typeof setTimeout> | undefined;
  const clearRemote = () => { clearTimeout(remoteTimer); setRemoteTyping(false); };
  const stop = () => {
    clearTimeout(idleTimer);
    if (localActive && socket.connected) socket.volatile.emit('typing', { conversationId, isTyping: false });
    localActive = false;
  };
  const update = (active: boolean) => {
    if (!active || !socket.connected) { stop(); return; }
    const now = Date.now();
    if (now - lastSent >= 1000) {
      socket.volatile.emit('typing', { conversationId, isTyping: true });
      lastSent = now;
      localActive = true;
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, 1500);
  };
  const receive = (data: TypingEvent) => {
    if (!record(data) || data.conversationId !== conversationId || typeof data.isTyping !== 'boolean'
    || typeof data.isAgent !== 'boolean' || data.isAgent === isAgent) return;
    clearRemote();
    if (data.isTyping) {
      setRemoteTyping(true);
      remoteTimer = setTimeout(clearRemote, 4000);
    }
  };
  const message = (data: Message) => {
    if (data.conversation_id === conversationId && data.sender_type === (isAgent ? 'visitor' : 'agent')) clearRemote();
  };
  const reset = () => { stop(); clearRemote(); };
  socket.on('typing', receive);
  socket.on('new_message', message);
  socket.on('disconnect', reset);
  socket.on('session_expired', reset);
  return { update, dispose: () => {
    stop();
    clearTimeout(remoteTimer);
    socket.off('typing', receive);
    socket.off('new_message', message);
    socket.off('disconnect', reset);
    socket.off('session_expired', reset);
  } };
}
