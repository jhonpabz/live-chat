import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useStaffAccount } from '@/features/auth/useStaffAccount';
import { useAgentManagement } from '@/features/agents/useAgentManagement';
import { useChatSession } from '@/features/chat/useChatSession';
import type { Agent } from '@/lib/contracts';

export default function AgentManagement() {
  const auth = useStaffAccount();
  if (auth.error) return <main className="p-6"><p role="alert">{auth.error}</p><Button onClick={auth.retry}>Retry</Button></main>;
  if (!auth.account || !auth.token) return <p className="p-6" role="status">Loading account…</p>;
  if (auth.account.role !== 'super_admin') return <main className="p-6"><p role="alert">Super-admin access required.</p><Link to="/dashboard">Return to inbox</Link></main>;
  return <Management token={auth.token} logout={auth.logout} />;
}
function Management({ token, logout }: { token: string; logout: () => void }) {
  const data = useAgentManagement(token, logout);
  const session = useChatSession('agent', token);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [capacity, setCapacity] = useState(5);
  useEffect(() => { if (session.expired) logout(); }, [session.expired, logout]);
  useEffect(() => {
    const refresh = () => { void data.refresh(); };
    session.socket.on('conversation_update', refresh);
    return () => { session.socket.off('conversation_update', refresh); };
  }, [session.socket, data.refresh]);
  const clear = () => { setEditing(null); setName(''); setEmail(''); setCapacity(5); };
  return <main className="max-w-5xl mx-auto p-6 space-y-6">
    <header className="flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-semibold">Agent management</h1><nav className="flex gap-4"><Link className="underline" to="/dashboard">Inbox oversight</Link><button className="underline" onClick={logout}>Sign out</button></nav></header>
    {data.error && <p role="alert" className="text-destructive">{data.error} <button className="underline" onClick={() => { void data.refresh(); }}>Retry</button></p>}
    {data.credential && <section className="border rounded p-4 space-y-2" role="status">
      <h2 className="font-semibold">Deliver this one-time setup link privately</h2>
      <p className="text-sm">Expires {new Date(data.credential.expiresAt).toLocaleString()}. It will not be displayed again after you leave this page.</p>
      <input aria-label="Password setup link" readOnly className="border rounded p-2 w-full bg-background" value={`${window.location.origin}/set-password#token=${data.credential.setupToken}`} onFocus={e => e.target.select()} />
      <Button variant="outline" onClick={data.dismissCredential}>Dismiss link</Button>
    </section>}
    <form className="border rounded p-4 space-y-3" onSubmit={event => { event.preventDefault(); void data.save({ name, email, capacity }, editing?.id).then(saved => { if (saved) clear(); }); }}>
      <h2 className="font-semibold">{editing ? 'Edit agent' : 'Invite an agent'}</h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <label>Name<input className="block w-full border rounded p-2 bg-background" required maxLength={255} value={name} onChange={e => setName(e.target.value)} /></label>
        <label>Email<input className="block w-full border rounded p-2 bg-background" type="email" required maxLength={255} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Maximum active chats<input className="block w-full border rounded p-2 bg-background" type="number" min={1} max={100} required value={capacity} onChange={e => setCapacity(Number(e.target.value))} /></label>
      </div>
      <Button disabled={data.busy}>{data.busy ? 'Saving…' : editing ? 'Save changes' : 'Create invitation'}</Button>
      {editing && <Button className="ml-2" variant="outline" type="button" onClick={clear}>Cancel edit</Button>}
    </form>
    <p className="text-sm text-muted-foreground">Deactivation signs out every tab and returns open chats to the queue. Password resets sign out the agent and keep their chat assignments.</p>
    {data.loading && <p role="status">Loading agents…</p>}
    {!data.loading && data.agents.length === 0 && <p>No agents yet. Create an invitation above.</p>}
    <ul className="space-y-3">{data.agents.map(agent => <li key={agent.id} className="border rounded p-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">{agent.name}</h2><p>{agent.email}</p><p className="text-sm text-muted-foreground">{agent.is_active ? agent.pending_setup ? 'Awaiting password setup' : 'Active' : 'Deactivated'} · {agent.active_chats}/{agent.capacity} active chats</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={data.busy} onClick={() => { setEditing(agent); setName(agent.name); setEmail(agent.email); setCapacity(agent.capacity); }}>Edit</Button>
        <Button variant="outline" disabled={data.busy || !agent.is_active} onClick={() => { void data.reset(agent.id); }}>Reset password</Button>
        <Button variant="outline" disabled={data.busy} onClick={() => { void data.setActive(agent); }}>{agent.is_active ? 'Deactivate' : 'Reactivate'}</Button>
      </div>
    </li>)}</ul>
    {data.hasMore && <Button disabled={data.loading} onClick={() => { void data.loadMore(); }}>Load more agents</Button>}
  </main>;
}
