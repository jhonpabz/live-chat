import { useState } from 'react';
import type { ChatSocket } from '@/lib/contracts';
import { useTyping } from '@/features/chat/useTyping';
import { Button } from './ui/button';

interface Props {
  socket: ChatSocket;
  conversationId: string | null;
  isAgent: boolean;
  disabled: boolean;
  retryDisabled?: boolean;
  sending: boolean;
  pendingContent?: string;
  onSend: (content: string) => Promise<boolean>;
  onRetry: () => Promise<boolean>;
}

export function MessageComposer({ socket, conversationId, isAgent, disabled, retryDisabled = disabled, sending, pendingContent, onSend, onRetry }: Props) {
  const [input, setInput] = useState('');
  const typing = useTyping(socket, conversationId, isAgent, !disabled);
  return (
    <div className="p-3 border-t">
      <p className="min-h-5 mb-1 text-xs text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">{typing.remoteTyping ? (isAgent ? 'Visitor is typing...' : 'Support is typing...') : ''}</p>
      {pendingContent && !sending && (
        <div className="mb-2 text-sm" role="status">
          <p className="break-words">Send unconfirmed: {pendingContent}</p>
          <Button variant="outline" size="sm" disabled={retryDisabled} onClick={() => { void onRetry().then(saved => { if (saved) setInput(''); }); }}>Retry same message</Button>
        </div>
      )}
      <form className="flex gap-2" onSubmit={event => {
        event.preventDefault();
        if (disabled || sending || pendingContent || !input.trim()) return;
        typing.updateTyping(false);
        void onSend(input).then(saved => { if (saved) setInput(''); });
      }}>
        <input aria-label="Message" value={input} onChange={event => { setInput(event.target.value); typing.updateTyping(Boolean(event.target.value.trim())); }} onBlur={() => typing.updateTyping(false)} maxLength={4000}
          disabled={disabled || sending || !!pendingContent} placeholder="Type a message…"
          className="min-w-0 flex-1 px-3 py-2 border rounded-md bg-background text-sm" />
        <Button type="submit" disabled={disabled || sending || !!pendingContent || !input.trim()}>{sending ? 'Sending…' : 'Send'}</Button>
      </form>
    </div>
  );
}
