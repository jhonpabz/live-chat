import type { Socket } from 'socket.io-client';

export type AgentStatus = 'online' | 'offline';
export type InboxView = 'queue' | 'mine' | 'all';
export interface Agent {
  id: string; name: string; email: string; role: 'agent' | 'super_admin';
  is_active: boolean; capacity: number; active_chats: number; pending_setup: boolean;
}
export interface AgentPage { agents: Agent[]; hasMore: boolean }
export interface SetupCredential { setupToken: string; expiresAt: string }
export function isAgent(value: unknown): value is Agent {
  return record(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.email === 'string'
    && (value.role === 'agent' || value.role === 'super_admin') && typeof value.is_active === 'boolean'
    && typeof value.capacity === 'number' && typeof value.active_chats === 'number' && typeof value.pending_setup === 'boolean';
}
export function isAgentPage(value: unknown): value is AgentPage {
  return record(value) && Array.isArray(value.agents) && value.agents.every(isAgent) && typeof value.hasMore === 'boolean';
}
export function isSetupCredential(value: unknown): value is SetupCredential {
  return record(value) && typeof value.setupToken === 'string' && typeof value.expiresAt === 'string';
}
export interface Message {
  id: string;
  conversation_id: string;
  sender_type: 'agent' | 'visitor' | 'system';
  content: string;
  /** ISO 8601 UTC. Ordering uses created_at then id. */
  created_at: string;
  client_message_id: string | null;
}
export interface Conversation {
  id: string;
  visitor_id: string;
  visitor_identity_id: string;
  status: string;
  last_message: string | null;
  ip_address: string | null;
  location: string | null;
  updated_at: string;
  created_at: string;
  agent_id: string | null;
  agent_name: string | null;
}
export interface HistoryPage { messages: Message[]; hasMore: boolean }
export interface ConversationPage { conversations: Conversation[]; hasMore: boolean }
export interface Ready { conversationId: string; visitorToken: string }
export interface VisitorPresence { onlineVisitorIds: string[] }
export interface Failure { code: string; message: string }
export type Ack<T> = { ok: true; data: T } | { ok: false; error: Failure };
export interface SendMessage { conversationId: string; content: string; clientMessageId: string }
export interface HistoryRequest { conversationId: string; before?: string; after?: string; limit?: number }
interface ServerEvents {
  new_message: (message: Message) => void;
  conversation_update: (data: Record<string, never>) => void;
  conversation_resolved: (data: { id: string }) => void;
  conversation_ready: (data: Ready) => void;
  support_availability: (data: { online: boolean }) => void;
  agent_status_current: (status: AgentStatus) => void;
  presence_changed: () => void;
  service_state: (data: { redis: boolean }) => void;
  session_expired: () => void;
  request_error: (error: Failure) => void;
}
interface ClientEvents {
  visitor_join: (data: Record<string, never>, ack: (result: Ack<Ready>) => void) => void;
  message_history: (data: HistoryRequest, ack: (result: Ack<HistoryPage>) => void) => void;
  send_message: (data: SendMessage, ack: (result: Ack<Message>) => void) => void;
  agent_status: (status: AgentStatus, ack: (result: Ack<{ status: AgentStatus }>) => void) => void;
  visitor_presence: (data: { visitorIds: string[] }, ack: (result: Ack<VisitorPresence>) => void) => void;
}
export type ChatSocket = Socket<ServerEvents, ClientEvents>;

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isMessage(value: unknown): value is Message {
  return record(value) && typeof value.id === 'string' && typeof value.conversation_id === 'string'
    && ['agent', 'visitor', 'system'].includes(String(value.sender_type)) && typeof value.content === 'string'
    && typeof value.created_at === 'string' && (value.client_message_id === null || typeof value.client_message_id === 'string');
}
export function isHistory(value: unknown): value is HistoryPage {
  return record(value) && Array.isArray(value.messages) && value.messages.every(isMessage) && typeof value.hasMore === 'boolean';
}
export function isConversationPage(value: unknown): value is ConversationPage {
  return record(value) && typeof value.hasMore === 'boolean' && Array.isArray(value.conversations)
    && value.conversations.every(item => record(item) && typeof item.id === 'string' && typeof item.visitor_id === 'string'
      && typeof item.visitor_identity_id === 'string' && typeof item.status === 'string' && typeof item.updated_at === 'string'
      && typeof item.created_at === 'string'
      && [item.last_message, item.ip_address, item.location, item.agent_id, item.agent_name].every(field => field === null || typeof field === 'string'));
}
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
