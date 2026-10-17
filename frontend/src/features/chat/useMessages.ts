import { useCallback, useEffect, useRef, useState } from 'react';
import { acknowledged, errorMessage } from '@/lib/api';
import { isHistory, isMessage, mergeMessages, type ChatSocket, type HistoryPage, type Message, type SendMessage } from '@/lib/contracts';

type HistoryLoader = (options: { before?: string; after?: string }) => Promise<HistoryPage>;

export function useMessages(socket: ChatSocket, conversationId: string | null, connected: boolean, loadHistory: HistoryLoader) {
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<SendMessage | null>(null);
  const [sending, setSending] = useState(false);
  const generationRef = useRef(0);
  const sendBusyRef = useRef(false);
  const historyBusyRef = useRef(false);
  const loadedRef = useRef(false);
  const syncCursorRef = useRef<string>();
  const loaderRef = useRef(loadHistory);
  loaderRef.current = loadHistory;

  const merge = useCallback((incoming: Message[]) => {
    const merged = mergeMessages(messagesRef.current, incoming);
    messagesRef.current = merged;
    setMessages(merged);
  }, []);

  useEffect(() => {
    ++generationRef.current;
    messagesRef.current = [];
    loadedRef.current = false;
    syncCursorRef.current = undefined;
    historyBusyRef.current = false;
    sendBusyRef.current = false;
    setMessages([]);
    setPending(null);
    setSending(false);
    setError('');
    setHasOlder(false);
    return () => { ++generationRef.current; };
  }, [conversationId]);

  const synchronize = useCallback(async () => {
    if (!conversationId || !connected || historyBusyRef.current) return;
    const generation = generationRef.current;
    historyBusyRef.current = true;
    setLoading(true);
    setError('');
    try {
      let after = loadedRef.current ? syncCursorRef.current : undefined;
      // Drain bounded pages after reconnect; do not rely on event delivery.
      for (let pages = 0; pages < 100; pages++) {
        const result = await loaderRef.current(after ? { after } : {});
        if (generation !== generationRef.current) return;
        if (!isHistory(result)) throw new Error('Invalid history response.');
        merge(result.messages);
        const last = result.messages[result.messages.length - 1]?.id;
        if (last) syncCursorRef.current = last;
        if (!after) setHasOlder(result.hasMore);
        loadedRef.current = true;
        if (!after || !result.hasMore) return;
        after = result.messages[result.messages.length - 1]?.id;
        if (!after) return;
      }
      throw new Error('More messages are available. Retry to continue syncing.');
    } catch (failure) {
      if (generation === generationRef.current) setError(errorMessage(failure));
    } finally {
      if (generation === generationRef.current) { historyBusyRef.current = false; setLoading(false); }
    }
  }, [conversationId, connected, merge]);

  useEffect(() => {
    const receive = (message: Message) => {
      if (isMessage(message) && message.conversation_id === conversationId) merge([message]);
    };
    socket.on('new_message', receive);
    void synchronize();
    return () => { socket.off('new_message', receive); };
  }, [socket, conversationId, synchronize, merge]);

  const loadOlder = async () => {
    const before = messagesRef.current[0]?.id;
    if (!before || !connected || historyBusyRef.current) return;
    const generation = generationRef.current;
    historyBusyRef.current = true;
    setLoading(true);
    try {
      const result = await loaderRef.current({ before });
      if (generation !== generationRef.current) return;
      if (!isHistory(result)) throw new Error('Invalid history response.');
      merge(result.messages);
      setHasOlder(result.hasMore);
      setError('');
    } catch (failure) {
      if (generation === generationRef.current) setError(errorMessage(failure));
    } finally {
      if (generation === generationRef.current) { historyBusyRef.current = false; setLoading(false); }
    }
  };

  const submit = async (payload: SendMessage) => {
    if (!connected || sendBusyRef.current) return false;
    const generation = generationRef.current;
    sendBusyRef.current = true;
    setSending(true);
    setPending(payload);
    setError('');
    try {
      const message = await acknowledged(socket.timeout(10000).emitWithAck('send_message', payload));
      if (!isMessage(message)) throw new Error('Invalid send confirmation.');
      if (generation === generationRef.current) { merge([message]); setPending(null); }
      return true;
    } catch (failure) {
      if (generation === generationRef.current) setError(errorMessage(failure));
      return false;
    } finally {
      if (generation === generationRef.current) { sendBusyRef.current = false; setSending(false); }
    }
  };
  const send = async (content: string) => {
    if (!conversationId || !content.trim() || content.length > 4000 || pending) return false;
    return submit({ conversationId, content: content.trim(), clientMessageId: crypto.randomUUID() });
  };
  return { messages, loading, hasOlder, error, pending, sending, send, retrySend: () => pending ? submit(pending) : Promise.resolve(false), loadOlder, synchronize };
}
