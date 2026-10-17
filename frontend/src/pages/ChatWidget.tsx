import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageComposer } from '@/components/MessageComposer';
import { MessageList } from '@/components/MessageList';
import { useVisitorChat } from '@/features/chat/useVisitorChat';

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const chat = useVisitorChat();
  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOpen ? <Button aria-label="Open support chat" onClick={() => setIsOpen(true)} className="rounded-full h-14 w-14 shadow-lg"><MessageCircle className="h-6 w-6" /></Button> : (
        <section aria-label="Support chat" className="w-80 max-w-[calc(100vw-2rem)] h-[500px] max-h-[calc(100dvh-2rem)] bg-card border rounded-lg shadow-xl flex flex-col">
          <div className="p-4 border-b flex items-center justify-between bg-primary text-primary-foreground rounded-t-lg">
            <div><h1 className="font-semibold">Support</h1><p className="text-xs opacity-80" role="status">{!chat.connected ? 'Connecting…' : chat.agentOnline ? 'Online' : 'Offline'}</p></div>
            <Button aria-label="Close support chat" variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="text-primary-foreground"><X className="h-4 w-4" /></Button>
          </div>
          {chat.settings.announcement_enabled === 'true' && chat.settings.announcement && <p className="p-2 bg-secondary text-xs text-center">{chat.settings.announcement}</p>}
          {chat.degraded && <p className="p-2 text-xs" role="status">Presence service is degraded.</p>}
          {chat.error && <div className="p-2 text-xs text-destructive" role="alert">{chat.error} <button className="underline" onClick={() => { if (!chat.connected) chat.reconnect(); else if (!chat.conversationId) void chat.join(); else void chat.synchronize(); }}>Retry loading</button></div>}
          {!chat.connected && !chat.expired && <button className="p-2 text-sm underline" onClick={chat.reconnect}>Reconnect</button>}
          {chat.expired && <Button variant="outline" onClick={chat.newSession}>Start a new session</Button>}
          <MessageList messages={chat.messages} ownSender="visitor" loading={chat.loading || chat.joining} hasOlder={chat.hasOlder} onLoadOlder={() => { void chat.loadOlder(); }} welcome={chat.settings.welcome_message} />
          {chat.resolved && <div className="p-2 text-sm" role="status">This conversation is resolved. <button className="underline" onClick={() => { void chat.join(); }}>Start a new chat</button></div>}
          <MessageComposer key={chat.conversationId || 'connecting'} disabled={!chat.connected || !chat.conversationId || chat.resolved || chat.joining || chat.expired} retryDisabled={!chat.connected || chat.joining || chat.expired} sending={chat.sending} pendingContent={chat.pending?.content} onSend={chat.send} onRetry={chat.retrySend} />
        </section>
      )}
    </div>
  );
}
