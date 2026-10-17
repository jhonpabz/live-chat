import { useCallback, useEffect, useRef, useState } from 'react';
import { acknowledged, api, errorMessage } from '@/lib/api';
import { record, type HistoryPage, type Ready } from '@/lib/contracts';
import { useChatSession } from './useChatSession';
import { useMessages } from './useMessages';

interface Settings { welcome_message?: string; announcement?: string; announcement_enabled?: string }
const isSettings = (value: unknown): value is Settings => record(value)
  && ['welcome_message', 'announcement', 'announcement_enabled'].every(key => value[key] === undefined || typeof value[key] === 'string');

export function useVisitorChat() {
  const session = useChatSession('visitor');
  const { socket, connected } = session;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [agentOnline, setAgentOnline] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [joining, setJoining] = useState(false);
  const joiningRef = useRef(false);
  const [error, setError] = useState('');
  const activeRef = useRef(true);
  const joinGeneration = useRef(0);

  const join = useCallback(async () => {
    if (!socket.connected || joiningRef.current) return;
    joiningRef.current = true;
    const generation = ++joinGeneration.current;
    setJoining(true);
    try {
      const ready = await acknowledged<Ready>(socket.timeout(10000).emitWithAck('visitor_join', {}));
      if (activeRef.current && generation === joinGeneration.current) acceptReady(ready);
    } catch (failure) {
      if (activeRef.current && generation === joinGeneration.current) setError(errorMessage(failure));
    } finally {
      if (generation === joinGeneration.current) { joiningRef.current = false; if (activeRef.current) setJoining(false); }
    }
    function acceptReady(ready: Ready) {
      localStorage.setItem('visitorToken', ready.visitorToken);
      conversationRef.current = ready.conversationId;
      setConversationId(ready.conversationId);
      setResolved(false);
      setError('');
    }
  }, [socket]);

  useEffect(() => {
    activeRef.current = true;
    const controller = new AbortController();
    api('/api/settings', isSettings, undefined, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setSettings(value); })
      .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    const ready = (value: Ready) => {
      localStorage.setItem('visitorToken', value.visitorToken);
      conversationRef.current = value.conversationId;
      setConversationId(value.conversationId);
      setResolved(false);
    };
    const availability = (value: { online: boolean }) => setAgentOnline(value.online);
    const onResolved = (value: { id: string }) => { if (value.id === conversationRef.current) setResolved(true); };
    const onDisconnect = () => {
      setAgentOnline(false);
      ++joinGeneration.current;
      joiningRef.current = false;
      setJoining(false);
    };
    socket.on('connect', join);
    socket.on('conversation_ready', ready);
    socket.on('support_availability', availability);
    socket.on('conversation_resolved', onResolved);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) void join();
    return () => {
      activeRef.current = false;
      ++joinGeneration.current;
      joiningRef.current = false;
      controller.abort();
      socket.off('connect', join);
      socket.off('conversation_ready', ready);
      socket.off('support_availability', availability);
      socket.off('conversation_resolved', onResolved);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket, join]);

  const loadHistory = useCallback((options: { before?: string; after?: string }) =>
    acknowledged<HistoryPage>(socket.timeout(10000).emitWithAck('message_history', { conversationId: conversationId || '', ...options })), [socket, conversationId]);
  const chat = useMessages(socket, conversationId, connected && !joining, loadHistory);
  const newSession = () => {
    setConversationId(null);
    conversationRef.current = null;
    session.newVisitorSession();
  };
  return { ...session, ...chat, settings, conversationId, agentOnline, resolved, joining, join, newSession, error: error || chat.error || session.error };
}
