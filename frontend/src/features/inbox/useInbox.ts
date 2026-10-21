import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, RequestError } from '@/lib/api';
import { isConversationPage, record, type ChatSocket, type Conversation, type InboxView } from '@/lib/contracts';

export function useInbox(socket: ChatSocket, connected: boolean, token: string | null, view: InboxView) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const requestRef = useRef(0);
  const activeRef = useRef(true);
  const refresh = useCallback(async (before?: string) => {
    if (!token) return;
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await api(`/api/conversations?view=${view}${before ? `&before=${before}` : ''}`, isConversationPage, token);
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
  }, [token, view]);

  useEffect(() => { setConversations([]); setHasMore(false); }, [view]);
  const accept = async (id: string) => {
    if (!token || accepting) return false;
    setAccepting(id); setError('');
    try {
      await api(`/api/conversations/${id}/accept`, (value): value is { id: string } => record(value) && typeof value.id === 'string', token, { method: 'POST' });
      await refresh();
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof RequestError && failure.code === 'UNAUTHORIZED') setUnauthorized(true);
      return false;
    } finally { setAccepting(null); }
  };

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
  return { conversations, loading, hasMore, error, unauthorized, accepting, accept, refresh, loadMore: () => refresh(conversations[conversations.length - 1]?.id) };
}
