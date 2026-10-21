import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { record } from '@/lib/contracts';

export function usePasswordSetup() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (password: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api('/api/auth/set-password', (v): v is { success: true } => record(v) && v.success === true, undefined,
        { method: 'POST', body: JSON.stringify({ token, password }) });
      window.history.replaceState(null, '', '/set-password');
      setDone(true);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  return { submit, busy, error, done, hasToken: Boolean(token) };
}
