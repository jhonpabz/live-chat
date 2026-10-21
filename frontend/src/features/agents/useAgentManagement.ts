import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, RequestError } from '@/lib/api';
import { isAgent, isAgentPage, isSetupCredential, type Agent, type SetupCredential } from '@/lib/contracts';

export interface AgentInput { name: string; email: string; capacity: number }
export function useAgentManagement(token: string, logout: () => void) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [credential, setCredential] = useState<SetupCredential | null>(null);
  const generation = useRef(0);
  const active = useRef(true);
  const mutationBusy = useRef(false);
  const fail = useCallback((failure: unknown) => {
    if (failure instanceof RequestError && failure.code === 'UNAUTHORIZED') logout();
    else setError(errorMessage(failure));
  }, [logout]);
  const refresh = useCallback(async (before?: string) => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const result = await api(`/api/agents${before ? `?before=${before}` : ''}`, isAgentPage, token);
      if (!active.current || request !== generation.current) return;
      setAgents(current => before ? [...new Map([...current, ...result.agents].map(a => [a.id, a])).values()] : result.agents);
      setHasMore(result.hasMore); setError('');
    } catch (failure) { if (active.current && request === generation.current) fail(failure); }
    finally { if (active.current && request === generation.current) setLoading(false); }
  }, [token, fail]);
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; ++generation.current; }; }, [refresh]);
  async function mutate(work: () => Promise<unknown>) {
    if (mutationBusy.current) return false;
    mutationBusy.current = true;
    setBusy(true); setError(''); setCredential(null);
    try { await work(); await refresh(); return true; }
    catch (failure) { fail(failure); return false; }
    finally { mutationBusy.current = false; setBusy(false); }
  }
  return {
    agents, hasMore, busy, loading, error, credential, refresh,
    dismissCredential: () => setCredential(null),
    loadMore: () => refresh(agents[agents.length - 1]?.id),
    save: (input: AgentInput, id?: string) => mutate(async () => {
      if (id) await api(`/api/agents/${id}`, isAgent, token, { method: 'PATCH', body: JSON.stringify(input) });
      else setCredential(await api('/api/agents', isSetupCredential, token, { method: 'POST', body: JSON.stringify(input) }));
    }),
    setActive: (agent: Agent) => mutate(() => api(`/api/agents/${agent.id}/status`, isAgent, token, { method: 'POST', body: JSON.stringify({ active: !agent.is_active }) })),
    reset: (id: string) => mutate(async () => { setCredential(await api(`/api/agents/${id}/reset-password`, isSetupCredential, token, { method: 'POST' })); })
  };
}
