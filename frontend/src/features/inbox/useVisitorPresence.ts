import { useEffect, useState } from 'react';
import { acknowledged, errorMessage } from '@/lib/api';
import { record, type ChatSocket, type VisitorPresence } from '@/lib/contracts';

export type VisitorStatus = 'online' | 'offline' | 'checking' | 'unknown';

export function useVisitorPresence(socket: ChatSocket, connected: boolean, visitorIds: string[]) {
  const idsKey = [...new Set(visitorIds)].sort().join(',');
  const [known, setKnown] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const ids = idsKey ? idsKey.split(',') : [];
    const tracked = new Set(ids);
    setKnown({});
    setError('');
    if (!connected) return;

    // Events contain no visitor identity. Refetch an authorized snapshot.
    const onChange = () => { active = false; setAttempt(current => current + 1); };
    const onDisconnect = () => { active = false; setKnown({}); };
    socket.on('presence_changed', onChange);
    socket.on('disconnect', onDisconnect);

    async function snapshot() {
      try {
        for (let offset = 0; offset < ids.length && active; offset += 100) {
          const batch = ids.slice(offset, offset + 100);
          const result = await acknowledged<VisitorPresence>(socket.timeout(10000).emitWithAck('visitor_presence', { visitorIds: batch }));
          if (!active) return;
          if (!record(result) || !Array.isArray(result.onlineVisitorIds) || !result.onlineVisitorIds.every(id => typeof id === 'string' && tracked.has(id))) {
            throw new Error('Invalid visitor presence response.');
          }
          const online = new Set(result.onlineVisitorIds);
          setKnown(current => {
            const next = { ...current };
            for (const id of batch) next[id] = online.has(id);
            return next;
          });
        }
      } catch (failure) {
        if (active) setError(errorMessage(failure));
      }
    }
    void snapshot();
    return () => {
      active = false;
      socket.off('presence_changed', onChange);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket, connected, idsKey, attempt]);

  const status = (visitorId: string): VisitorStatus => {
    if (!connected) return 'unknown';
    if (known[visitorId] === undefined) return error ? 'unknown' : 'checking';
    return known[visitorId] ? 'online' : 'offline';
  };
  return { status, error, refresh: () => setAttempt(current => current + 1) };
}
