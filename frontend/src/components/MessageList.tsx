import { useEffect, useRef } from 'react';
import { Button } from './ui/button';
import type { Message } from '@/lib/contracts';

interface Props {
  messages: Message[];
  ownSender: 'agent' | 'visitor';
  loading: boolean;
  hasOlder: boolean;
  onLoadOlder: () => void;
  welcome?: string;
}

export function MessageList({ messages, ownSender, loading, hasOlder, onLoadOlder, welcome }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const container = containerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [lastId]);
  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3" role="log" aria-label="Conversation messages" aria-busy={loading}>
      {hasOlder && <Button variant="outline" size="sm" onClick={onLoadOlder} disabled={loading}>Load earlier messages</Button>}
      {loading && <p className="text-xs text-muted-foreground" role="status">Loading messages…</p>}
      {!loading && messages.length === 0 && <p className="bg-muted p-3 rounded-lg text-sm">{welcome || 'No messages yet.'}</p>}
      {messages.map(message => (
        <div key={message.id} className={`flex ${message.sender_type === ownSender ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[80%] whitespace-pre-wrap break-words p-3 rounded-lg text-sm ${message.sender_type === ownSender ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            {message.content}
          </div>
        </div>
      ))}
    </div>
  );
}
