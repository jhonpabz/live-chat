import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { MessageCircle, X, Send } from 'lucide-react';

interface Message {
  id: string;
  content: string;
  sender_type: string;
  created_at: string;
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [visitorId] = useState(() => localStorage.getItem('visitorId') || `vis_${Date.now()}`);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>({});
  const [agentOnline, setAgentOnline] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('visitorId', visitorId);

    // Fetch settings
    fetch('/api/settings').then(r => r.json()).then(setSettings);

    const socket = io('/', { path: '/socket.io' });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('visitor_join', { visitorId, conversationId });
    });

    socket.on('conversation_ready', (data) => {
      setConversationId(data.conversationId);
    });

    socket.on('new_message', (msg: Message) => {
      setMessages(prev => [...prev, msg]);
    });

    // For demo: create conversation on first message if needed
    // In real, backend would create on first message

    return () => {
      socket.disconnect();
    };
  }, [visitorId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim() || !socketRef.current || !conversationId) return;

    socketRef.current.emit('send_message', {
      conversationId,
      content: input,
      senderType: 'visitor'
    });

    setInput('');
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOpen ? (
        <Button
          onClick={() => setIsOpen(true)}
          className="rounded-full h-14 w-14 shadow-lg"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      ) : (
        <div className="w-80 h-[500px] bg-card border rounded-lg shadow-xl flex flex-col">
          {/* Header */}
          <div className="p-4 border-b flex items-center justify-between bg-primary text-primary-foreground rounded-t-lg">
            <div>
              <h3 className="font-semibold">Support</h3>
              <p className="text-xs opacity-80">{agentOnline ? 'Online' : 'Offline'}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="text-primary-foreground">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Announcement */}
          {settings.announcement_enabled === 'true' && settings.announcement && (
            <div className="p-2 bg-secondary text-xs text-center">{settings.announcement}</div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {settings.welcome_message && messages.length === 0 && (
              <div className="bg-muted p-3 rounded-lg text-sm">{settings.welcome_message}</div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender_type === 'visitor' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] p-3 rounded-lg text-sm ${
                    msg.sender_type === 'visitor'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 border rounded-md bg-background text-sm"
            />
            <Button size="icon" onClick={sendMessage}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
