import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage, RequestError } from '@/lib/api';
import { isAgent, type Agent } from '@/lib/contracts';

export function useStaffAccount() {
  const token = localStorage.getItem('token');
  const navigate = useNavigate();
  const [account, setAccount] = useState<Agent | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const logout = useCallback(() => {
    localStorage.removeItem('token'); localStorage.removeItem('agent');
    navigate('/login', { replace: true });
  }, [navigate]);
  useEffect(() => {
    let active = true;
    if (!token) { logout(); return; }
    setError('');
    void api('/api/auth/me', isAgent, token).then(value => { if (active) setAccount(value); }).catch(failure => {
      if (!active) return;
      if (failure instanceof RequestError && failure.code === 'UNAUTHORIZED') logout();
      else setError(errorMessage(failure));
    });
    return () => { active = false; };
  }, [token, logout, attempt]);
  return { token, account, error, logout, retry: () => setAttempt(value => value + 1) };
}
