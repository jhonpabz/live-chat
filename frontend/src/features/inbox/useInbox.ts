import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, RequestError } from '@/lib/api';
import { isConversationPage, type ChatSocket, type Conversation } from '@/lib/contracts';

export function useInbox(socket: ChatSocket, connected: boolean, token: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const requestRef = useRef(0);
  const activeRef = useRef(true);
  const refresh = useCallback(async (before?: string) => {
    if (!token) return;
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await api(`/api/conversations${before ? `?before=${before}` : ''}`, isConversationPage, token);
      if (!activeRef.current || request !== requestRef.current) return;
      setConversations(current => before ? [...new Map([...current, ...result.conversations].map(item => [item.id, item])).values()] : result.conversations);
      setHasMore(result.hasMore);
      setError('');
    } catch (failure) {
      if (!activeRef.current || request !== requestRef.current) return;
      setError(errorMessage(failure));
      if (failure instanceof RequestError && failure.code === 'UNAUTHORIZED') setUnauthorized(true);
    } finally {
      if (activeRef.current && request === requestRef.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    activeRef.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void refresh(); }, 150);
    };
    socket.on('conversation_update', update);
    void refresh();
    return () => { activeRef.current = false; clearTimeout(timer); socket.off('conversation_update', update); };
  }, [socket, refresh, connected]);
  return { conversations, loading, hasMore, error, unauthorized, refresh, loadMore: () => refresh(conversations[conversations.length - 1]?.id) };
}
