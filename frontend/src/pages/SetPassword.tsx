import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { usePasswordSetup } from '@/features/auth/usePasswordSetup';

export default function SetPassword() {
  const setup = usePasswordSetup();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return <main className="min-h-screen flex items-center justify-center p-6">
    <section className="w-full max-w-md rounded-lg border p-8 space-y-4">
      <h1 className="text-2xl font-semibold">Set your password</h1>
      {setup.done ? <><p role="status">Your password is ready. Sign in to continue.</p><Link className="underline" to="/login">Go to login</Link></> : !setup.hasToken ?
        <p role="alert">Open the complete invitation or reset link provided by your administrator.</p> :
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (password === confirmation) void setup.submit(password); }}>
          <p className="text-sm text-muted-foreground">Use at least 12 characters and at most 72 UTF-8 bytes. Links expire after 24 hours and can be used once.</p>
          <label className="block">New password<input className="block w-full border rounded p-2 bg-background" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label className="block">Confirm password<input className="block w-full border rounded p-2 bg-background" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
          {confirmation && confirmation !== password && <p role="alert">Passwords do not match.</p>}
          {setup.error && <p role="alert" className="text-destructive">{setup.error}</p>}
          <Button disabled={setup.busy || password !== confirmation}>{setup.busy ? 'Saving…' : 'Save password'}</Button>
        </form>}
    </section>
  </main>;
}
