import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { MessageSquare, CheckCircle, Search } from 'lucide-react';

interface Conversation {
  id: string;
  visitor_id: string;
  status: string;
  last_message?: string;
  ip_address?: string;
  location?: string;
  updated_at: string;
}

interface Message {
  id: string;
  content: string;
  sender_type: string;
  created_at: string;
}

export default function AgentDashboard() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('online');
  const socketRef = useRef<Socket | null>(null);
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }

    fetchConversations();

    const socket = io('/', {
      path: '/socket.io',
      auth: { token }
    });
    socketRef.current = socket;

    socket.on('new_message', (msg: Message) => {
      if (selected && msg.conversation_id === selected.id) { // note: need conversation_id in msg
        setMessages(prev => [...prev, msg]);
      }
      fetchConversations();
    });

    socket.on('conversation_update', () => fetchConversations());

    return () => socket.disconnect();
  }, [token, selected]);

  const fetchConversations = async () => {
    const res = await fetch('/api/conversations', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setConversations(await res.json());
  };

  const selectConversation = async (conv: Conversation) => {
    setSelected(conv);
    const res = await fetch(`/api/conversations/${conv.id}/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setMessages(await res.json());
    socketRef.current?.emit('visitor_join', { conversationId: conv.id }); // join room
  };

  const sendMessage = () => {
    if (!input.trim() || !selected || !socketRef.current) return;
    socketRef.current.emit('send_message', {
      conversationId: selected.id,
      content: input,
      senderType: 'agent'
    });
    setInput('');
  };

  const resolve = async () => {
    if (!selected) return;
    await fetch(`/api/conversations/${selected.id}/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    setSelected(null);
    fetchConversations();
  };

  const filtered = conversations.filter(c =>
    (c.last_message || '').toLowerCase().includes(search.toLowerCase()) ||
    c.visitor_id.includes(search)
  );

  return (
    <div className="h-screen flex bg-background">
      {/* Sidebar */}
      <div className="w-80 border-r flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h1 className="font-semibold text-lg">Conversations</h1>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              socketRef.current?.emit('agent_status', e.target.value);
            }}
            className="text-sm border rounded px-2 py-1 bg-background"
          >
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>
        </div>
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border rounded-md bg-background text-sm"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((conv) => (
            <div
              key={conv.id}
              onClick={() => selectConversation(conv)}
              className={`p-4 border-b cursor-pointer hover:bg-accent ${selected?.id === conv.id ? 'bg-accent' : ''}`}
            >
              <div className="flex justify-between items-start">
                <span className="font-medium text-sm truncate">{conv.visitor_id.slice(0, 12)}...</span>
                <span className="text-xs text-muted-foreground">{new Date(conv.updated_at).toLocaleTimeString()}</span>
              </div>
              <p className="text-sm text-muted-foreground truncate mt-1">{conv.last_message || 'No messages'}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="p-4 border-b flex justify-between items-center">
              <div>
                <h2 className="font-semibold">Conversation</h2>
                <p className="text-xs text-muted-foreground">IP: {selected.ip_address || 'N/A'} | {selected.location || 'Unknown'}</p>
              </div>
              <Button variant="outline" size="sm" onClick={resolve}>
                <CheckCircle className="h-4 w-4 mr-1" /> Resolve
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.sender_type === 'agent' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] p-3 rounded-lg text-sm ${msg.sender_type === 'agent' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type a reply..."
                className="flex-1 px-3 py-2 border rounded-md bg-background"
              />
              <Button onClick={sendMessage}>Send</Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select a conversation to start</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
