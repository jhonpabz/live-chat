import { useEffect, useRef, useState } from 'react';
import type { ChatSocket } from '@/lib/contracts';
import { createTypingSession } from './typingSession';

export function useTyping(socket: ChatSocket, conversationId: string | null, isAgent: boolean, enabled: boolean) {
  const [remoteTyping, setRemoteTyping] = useState(false);
  const updateRef = useRef<(active: boolean) => void>(() => {});
  useEffect(() => {
    setRemoteTyping(false);
    if (!enabled || !conversationId) { updateRef.current = () => {}; return; }
    const session = createTypingSession(socket, conversationId, isAgent, setRemoteTyping);
    updateRef.current = session.update;
    const hidden = () => { if (document.hidden) session.update(false); };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      session.dispose();
      updateRef.current = () => {};
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [socket, conversationId, isAgent, enabled]);
  return { remoteTyping: enabled && remoteTyping, updateTyping: (active: boolean) => updateRef.current(active) };
}
