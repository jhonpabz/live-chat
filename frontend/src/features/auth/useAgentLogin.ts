import { useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { record } from '@/lib/contracts';

interface LoginResult { token: string; agent: { id: string; name: string; email: string } }
const isLoginResult = (value: unknown): value is LoginResult => record(value) && typeof value.token === 'string'
  && record(value.agent) && typeof value.agent.id === 'string' && typeof value.agent.name === 'string' && typeof value.agent.email === 'string';

export function useAgentLogin() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const login = async (email: string, password: string) => {
    if (busy.current) return false;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await api('/api/auth/login', isLoginResult, undefined, { method: 'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem('token', result.token);
      localStorage.setItem('agent', JSON.stringify(result.agent));
      return true;
    } catch (failure) { setError(errorMessage(failure)); return false; }
    finally { busy.current = false; setLoading(false); }
  };
  return { login, error, loading };
}
