import { useState } from 'react';
import { Button } from './ui/button';

interface Props {
  disabled: boolean;
  retryDisabled?: boolean;
  sending: boolean;
  pendingContent?: string;
  onSend: (content: string) => Promise<boolean>;
  onRetry: () => Promise<boolean>;
}

export function MessageComposer({ disabled, retryDisabled = disabled, sending, pendingContent, onSend, onRetry }: Props) {
  const [input, setInput] = useState('');
  return (
    <div className="p-3 border-t">
      {pendingContent && !sending && (
        <div className="mb-2 text-sm" role="status">
          <p className="break-words">Send unconfirmed: {pendingContent}</p>
          <Button variant="outline" size="sm" disabled={retryDisabled} onClick={() => { void onRetry().then(saved => { if (saved) setInput(''); }); }}>Retry same message</Button>
        </div>
      )}
      <form className="flex gap-2" onSubmit={event => {
        event.preventDefault();
        if (disabled || sending || pendingContent || !input.trim()) return;
        void onSend(input).then(saved => { if (saved) setInput(''); });
      }}>
        <input aria-label="Message" value={input} onChange={event => setInput(event.target.value)} maxLength={4000}
          disabled={disabled || sending || !!pendingContent} placeholder="Type a message…"
          className="min-w-0 flex-1 px-3 py-2 border rounded-md bg-background text-sm" />
        <Button type="submit" disabled={disabled || sending || !!pendingContent || !input.trim()}>{sending ? 'Sending…' : 'Send'}</Button>
      </form>
    </div>
  );
}
