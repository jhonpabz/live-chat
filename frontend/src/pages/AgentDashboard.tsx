import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare, CheckCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageComposer } from '@/components/MessageComposer';
import { MessageList } from '@/components/MessageList';
import { VisitorPresenceIndicator } from '@/components/VisitorPresenceIndicator';
import { useChatSession } from '@/features/chat/useChatSession';
import { useMessages } from '@/features/chat/useMessages';
import { useInbox } from '@/features/inbox/useInbox';
import { useVisitorPresence } from '@/features/inbox/useVisitorPresence';
import { api, errorMessage, RequestError } from '@/lib/api';
import { isHistory, record, type Agent, type Conversation, type InboxView } from '@/lib/contracts';
import { useStaffAccount } from '@/features/auth/useStaffAccount';

export default function AgentDashboard() {
  const auth = useStaffAccount();
  if (auth.error) return <main className="p-6"><p role="alert">{auth.error}</p><Button onClick={auth.retry}>Retry</Button></main>;
  if (!auth.account || !auth.token) return <p className="p-6" role="status">Loading account…</p>;
  return <InboxWorkspace account={auth.account} token={auth.token} logout={auth.logout} />;
}

function InboxWorkspace({ account, token, logout }: { account: Agent; token: string; logout: () => void }) {
  const isAdmin = account.role === 'super_admin';
  const [view, setView] = useState<InboxView>(isAdmin ? 'all' : 'mine');
  const navigate = useNavigate();
  const session = useChatSession('agent', token || undefined);
  const inbox = useInbox(session.socket, session.connected, token, view);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const visitors = useVisitorPresence(session.socket, session.connected, [
    ...inbox.conversations.map(conversation => conversation.visitor_identity_id),
    ...(selected ? [selected.visitor_identity_id] : [])
  ]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);
  const loadHistory = useCallback((options: { before?: string; after?: string }) => {
    const query = new URLSearchParams(options);
    return api(`/api/conversations/${selected?.id}/messages?${query}`, isHistory, token || undefined);
  }, [selected?.id, token]);
  const chat = useMessages(session.socket, selected?.id || null, session.connected, loadHistory);

  useEffect(() => {
    setSelected(current => current ? inbox.conversations.find(conversation => conversation.id === current.id) || null : null);
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
  const tabs: InboxView[] = isAdmin ? ['queue', 'all'] : ['mine', 'queue'];

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="p-3 border-b flex flex-wrap justify-between gap-3">
        <span>{account.name} · {isAdmin ? 'Super admin' : `Agent · capacity ${account.capacity}`}</span>
        <nav className="flex gap-4">{isAdmin && <Link className="underline" to="/agents">Manage agents</Link>}<button className="underline" onClick={logout}>Sign out</button></nav>
      </header>
      {!session.connected && <div className="p-2 border-b text-sm" role="status">Connecting to support server… <button className="underline" onClick={session.reconnect}>Reconnect</button></div>}
      {session.degraded && <p className="p-2 border-b text-sm" role="status">Presence cache is unavailable. Chat remains connected to this server.</p>}
      {visitors.error && <div className="p-2 border-b text-sm" role="alert">Visitor presence could not be loaded. <button className="underline" onClick={visitors.refresh}>Retry presence</button></div>}
      {visibleError && <div className="p-2 text-sm text-destructive" role="alert">{visibleError} <button className="underline" onClick={() => { void inbox.refresh(); void chat.synchronize(); }}>Retry loading</button></div>}
      <div className="flex flex-1 min-h-0">
        <aside className="w-56 sm:w-80 border-r flex flex-col">
          <div className="p-4 border-b flex items-center justify-between gap-2">
            <h1 className="font-semibold text-lg">Conversations</h1>
            {!isAdmin && <select aria-label="Agent availability" value={session.status} disabled={!session.connected}
              onChange={event => { if (event.target.value === 'online' || event.target.value === 'offline') void session.changeStatus(event.target.value); }}
              className="text-sm border rounded px-2 py-1 bg-background">
              <option value="online">Online</option><option value="offline">Offline</option>
            </select>}
          </div>
          <div className="p-3 flex flex-wrap gap-2 border-b" aria-label="Inbox views">
            {tabs.map(tab => <button key={tab} aria-pressed={view === tab} className={`rounded border px-2 py-1 text-sm ${view === tab ? 'bg-accent font-semibold' : ''}`} onClick={() => { setSelected(null); setView(tab); }}>{tab === 'mine' ? 'My Chats' : tab === 'queue' ? 'Waiting Queue' : 'All Chats'}</button>)}
          </div>
          <div className="p-3 border-b relative">
            <Search className="absolute left-6 top-5 h-4 w-4 text-muted-foreground" />
            <input aria-label="Search loaded conversations" placeholder="Search loaded chats…" value={search} onChange={event => setSearch(event.target.value)} className="w-full pl-9 pr-3 py-2 border rounded-md bg-background text-sm" />
          </div>
          <div className="flex-1 overflow-y-auto">
            {inbox.loading && <p className="p-3 text-sm" role="status">Loading conversations…</p>}
            {!inbox.loading && filtered.length === 0 && <p className="p-3 text-sm text-muted-foreground">No conversations found.</p>}
            {filtered.map(conversation => (
              <div key={conversation.id} className={`text-left w-full p-4 border-b ${selected?.id === conversation.id ? 'bg-accent' : ''}`}>
                <button type="button" className="block w-full text-left" disabled={view === 'queue' && !isAdmin} onClick={() => { setSelected(conversation); setError(''); }}>
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-sm truncate">{conversation.visitor_id.slice(0, 12)}…</span>
                  <span className="text-xs text-muted-foreground">{new Date(conversation.updated_at).toLocaleTimeString()}</span>
                </div>
                <p className="text-sm text-muted-foreground truncate mt-1">{view === 'queue' && !isAdmin ? `Waiting since ${new Date(conversation.created_at).toLocaleString()}` : conversation.last_message || 'No messages'}</p>
                <p className="text-xs text-muted-foreground">{conversation.status} · {conversation.agent_name || 'Unassigned'}</p>
                <VisitorPresenceIndicator status={visitors.status(conversation.visitor_identity_id)} />
                </button>
                {view === 'queue' && !isAdmin && <Button className="mt-2" size="sm" disabled={!session.connected || session.status !== 'online' || Boolean(inbox.accepting)} onClick={() => { void inbox.accept(conversation.id).then(accepted => { if (accepted) setView('mine'); }); }}>{inbox.accepting === conversation.id ? 'Accepting…' : 'Accept Chat'}</Button>}
              </div>
            ))}
            {inbox.hasMore && <Button variant="outline" className="m-3" disabled={inbox.loading} onClick={() => { void inbox.loadMore(); }}>Load more conversations</Button>}
          </div>
        </aside>
        <main className="flex-1 min-w-0 flex flex-col">
          {selected ? <>
            <div className="p-4 border-b flex justify-between items-center gap-2">
              <div><h2 className="font-semibold">Conversation</h2><VisitorPresenceIndicator status={visitors.status(selected.visitor_identity_id)} /><p className="text-xs text-muted-foreground">IP: {selected.ip_address || 'N/A'} | {selected.location || 'Unknown'}</p></div>
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
