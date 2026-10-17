import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, CheckCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageComposer } from '@/components/MessageComposer';
import { MessageList } from '@/components/MessageList';
import { useChatSession } from '@/features/chat/useChatSession';
import { useMessages } from '@/features/chat/useMessages';
import { useInbox } from '@/features/inbox/useInbox';
import { api, errorMessage, RequestError } from '@/lib/api';
import { isHistory, record, type Conversation } from '@/lib/contracts';

export default function AgentDashboard() {
  const token = localStorage.getItem('token');
  const navigate = useNavigate();
  const session = useChatSession('agent', token || undefined);
  const inbox = useInbox(session.socket, session.connected, token);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);
  const loadHistory = useCallback((options: { before?: string; after?: string }) => {
    const query = new URLSearchParams(options);
    return api(`/api/conversations/${selected?.id}/messages?${query}`, isHistory, token || undefined);
  }, [selected?.id, token]);
  const chat = useMessages(session.socket, selected?.id || null, session.connected, loadHistory);

  useEffect(() => {
    setSelected(current => current ? inbox.conversations.find(conversation => conversation.id === current.id) || current : null);
  }, [inbox.conversations]);

  useEffect(() => {
    if (!token || session.expired || inbox.unauthorized) {
      localStorage.removeItem('token');
      localStorage.removeItem('agent');
      navigate('/login', { replace: true });
    }
  }, [token, session.expired, inbox.unauthorized, navigate]);

  useEffect(() => {
    const resolved = (data: { id: string }) => setSelected(current => current?.id === data.id ? { ...current, status: 'resolved' } : current);
    session.socket.on('conversation_resolved', resolved);
    return () => { session.socket.off('conversation_resolved', resolved); };
  }, [session.socket]);

  const resolve = async () => {
    if (!selected || resolving) return;
    setResolving(true);
    setError('');
    try {
      await api(`/api/conversations/${selected.id}/resolve`, (value): value is { success: true } => record(value) && value.success === true, token || undefined, { method: 'POST' });
      setSelected(current => current?.id === selected.id ? { ...current, status: 'resolved' } : current);
      void inbox.refresh();
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof RequestError && failure.code === 'UNAUTHORIZED') navigate('/login');
    } finally { setResolving(false); }
  };
  const filtered = inbox.conversations.filter(conversation =>
    (conversation.last_message || '').toLowerCase().includes(search.toLowerCase()) || conversation.visitor_id.toLowerCase().includes(search.toLowerCase()));
  const visibleError = error || chat.error || inbox.error || session.error;

  return (
    <div className="h-screen flex flex-col bg-background">
      {!session.connected && <div className="p-2 border-b text-sm" role="status">Connecting to support server… <button className="underline" onClick={session.reconnect}>Reconnect</button></div>}
      {session.degraded && <p className="p-2 border-b text-sm" role="status">Presence cache is unavailable. Chat remains connected to this server.</p>}
      {visibleError && <div className="p-2 text-sm text-destructive" role="alert">{visibleError} <button className="underline" onClick={() => { void inbox.refresh(); void chat.synchronize(); }}>Retry loading</button></div>}
      <div className="flex flex-1 min-h-0">
        <aside className="w-56 sm:w-80 border-r flex flex-col">
          <div className="p-4 border-b flex items-center justify-between gap-2">
            <h1 className="font-semibold text-lg">Conversations</h1>
            <select aria-label="Agent availability" value={session.status} disabled={!session.connected}
              onChange={event => { if (event.target.value === 'online' || event.target.value === 'offline') void session.changeStatus(event.target.value); }}
              className="text-sm border rounded px-2 py-1 bg-background">
              <option value="online">Online</option><option value="offline">Offline</option>
            </select>
          </div>
          <div className="p-3 border-b relative">
            <Search className="absolute left-6 top-5 h-4 w-4 text-muted-foreground" />
            <input aria-label="Search loaded conversations" placeholder="Search loaded chats…" value={search} onChange={event => setSearch(event.target.value)} className="w-full pl-9 pr-3 py-2 border rounded-md bg-background text-sm" />
          </div>
          <div className="flex-1 overflow-y-auto">
            {inbox.loading && <p className="p-3 text-sm" role="status">Loading conversations…</p>}
            {!inbox.loading && filtered.length === 0 && <p className="p-3 text-sm text-muted-foreground">No conversations found.</p>}
            {filtered.map(conversation => (
              <button type="button" key={conversation.id} onClick={() => { setSelected(conversation); setError(''); }}
                className={`block text-left w-full p-4 border-b hover:bg-accent ${selected?.id === conversation.id ? 'bg-accent' : ''}`}>
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-sm truncate">{conversation.visitor_id.slice(0, 12)}…</span>
                  <span className="text-xs text-muted-foreground">{new Date(conversation.updated_at).toLocaleTimeString()}</span>
                </div>
                <p className="text-sm text-muted-foreground truncate mt-1">{conversation.last_message || 'No messages'}</p>
              </button>
            ))}
            {inbox.hasMore && <Button variant="outline" className="m-3" disabled={inbox.loading} onClick={() => { void inbox.loadMore(); }}>Load more conversations</Button>}
          </div>
        </aside>
        <main className="flex-1 min-w-0 flex flex-col">
          {selected ? <>
            <div className="p-4 border-b flex justify-between items-center gap-2">
              <div><h2 className="font-semibold">Conversation</h2><p className="text-xs text-muted-foreground">IP: {selected.ip_address || 'N/A'} | {selected.location || 'Unknown'}</p></div>
              <Button variant="outline" size="sm" disabled={resolving || selected.status === 'resolved'} onClick={() => { void resolve(); }}><CheckCircle className="h-4 w-4 mr-1" />{selected.status === 'resolved' ? 'Resolved' : resolving ? 'Resolving…' : 'Resolve'}</Button>
            </div>
            <MessageList messages={chat.messages} ownSender="agent" loading={chat.loading} hasOlder={chat.hasOlder} onLoadOlder={() => { void chat.loadOlder(); }} />
            <MessageComposer key={selected.id} disabled={!session.connected || selected.status !== 'open'} retryDisabled={!session.connected} sending={chat.sending} pendingContent={chat.pending?.content} onSend={chat.send} onRetry={chat.retrySend} />
          </> : <div className="flex-1 flex items-center justify-center text-muted-foreground"><div className="text-center"><MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" /><p>Select a conversation to start</p></div></div>}
        </main>
      </div>
    </div>
  );
}
