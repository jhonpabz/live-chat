import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { acknowledged, errorMessage } from '@/lib/api';
import { record, type AgentStatus, type ChatSocket, type Failure } from '@/lib/contracts';

export function useChatSession(role: 'agent' | 'visitor', token?: string) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('online');
  const statusRef = useRef<AgentStatus>('online');
  const socket: ChatSocket = useMemo(() => io('/', {
    autoConnect: false,
    path: '/socket.io',
    reconnectionAttempts: 8,
    reconnectionDelayMax: 5000,
    auth: callback => callback(role === 'agent' ? { token, status: statusRef.current } : { visitorToken: localStorage.getItem('visitorToken') || undefined })
  }), [role, token]);

  useEffect(() => {
    const onConnect = () => { setConnected(true); setError(''); setExpired(false); };
    const onDisconnect = () => setConnected(false);
    const onExpired = () => { setExpired(true); setError(role === 'agent' ? 'Your session expired. Please sign in again.' : 'Your visitor session expired. Start a new session.'); };
    const onError = (failure: Failure) => setError(failure.message);
    const onConnectError = (failure: Error) => {
      setError(failure.message);
      if ('data' in failure && record(failure.data) && failure.data.code === 'UNAUTHORIZED') onExpired();
    };
    const onStatus = (value: AgentStatus) => { statusRef.current = value; setStatus(value); };
    const onService = (value: { redis: boolean }) => setDegraded(!value.redis);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('session_expired', onExpired);
    socket.on('request_error', onError);
    socket.on('agent_status_current', onStatus);
    socket.on('service_state', onService);
    if (role !== 'agent' || token) socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('session_expired', onExpired);
      socket.off('request_error', onError);
      socket.off('agent_status_current', onStatus);
      socket.off('service_state', onService);
      socket.disconnect();
    };
  }, [socket, role, token]);

  const changeStatus = async (value: AgentStatus) => {
    try { await acknowledged(socket.timeout(10000).emitWithAck('agent_status', value)); }
    catch (failure) { setError(errorMessage(failure)); }
  };
  const reconnect = () => { setError(''); socket.connect(); };
  const newVisitorSession = () => {
    localStorage.removeItem('visitorToken');
    socket.disconnect();
    setExpired(false);
    reconnect();
  };
  return { socket, connected, error, expired, degraded, status, changeStatus, reconnect, newVisitorSession };
}
