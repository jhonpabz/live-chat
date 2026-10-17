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
    const changed = new Set<string>();
    setKnown({});
    setError('');
    if (!connected) return;

    const update = (payload: unknown, online: boolean) => {
      if (!record(payload) || typeof payload.visitorId !== 'string' || !tracked.has(payload.visitorId)) return;
      const id = payload.visitorId;
      changed.add(id);
      setKnown(current => ({ ...current, [id]: online }));
    };
    const onOnline = (payload: { visitorId: string }) => update(payload, true);
    const onOffline = (payload: { visitorId: string }) => update(payload, false);
    const onDisconnect = () => { active = false; setKnown({}); };
    socket.on('visitor_online', onOnline);
    socket.on('visitor_offline', onOffline);
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
          // A newer live transition must win over a snapshot still in flight.
          setKnown(current => {
            const next = { ...current };
            for (const id of batch) if (!changed.has(id)) next[id] = online.has(id);
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
      socket.off('visitor_online', onOnline);
      socket.off('visitor_offline', onOffline);
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
