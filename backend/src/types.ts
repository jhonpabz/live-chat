import type { Pool, PoolClient } from 'pg';

export type Role = 'agent' | 'super_admin' | 'visitor';
export type StaffRole = Exclude<Role, 'visitor'>;
export type Identity = { id: string; exp: number } & (
  { role: StaffRole; version: number } | { role: 'visitor' }
);
export type StaffIdentity = Extract<Identity, { role: StaffRole }>;
export type Context = Identity | null | undefined;
export type Database = Pool | PoolClient;
export interface Page { limit: number; before: string | null; after: string | null }
export interface Account {
  id: string; name: string; email: string; role: StaffRole; is_active: boolean;
  capacity: number; session_version: number; password_hash: string;
  setup_token_hash: string | null;
}
export interface AccountProfile {
  id: string; name: string; email: string; role: StaffRole; is_active: boolean;
  capacity: number; pending_setup: boolean; active_chats: number;
}
export interface AccountInput { name: string; email: string; capacity: number }
export interface Conversation { id: string; visitor_id: string; agent_id: string | null; status: 'open' | 'resolved' | 'closed' }
// Transport timestamps are ISO 8601 UTC strings, parsed by the pg timestamp parser.
export interface Message {
  id: string; conversation_id: string; sender_type: 'agent' | 'visitor' | 'system';
  content: string; created_at: string; client_message_id: string | null;
}
export interface ConversationSummary extends Omit<Conversation, 'visitor_id'> {
  visitor_id: string; visitor_identity_id: string; created_at: string; updated_at: string;
  agent_name: string | null; ip_address: string | null; location: string | null; last_message: string | null;
}
export interface MessageInput {
  conversationId: string; clientMessageId: string | null; content: string;
  senderType: Message['sender_type']; senderId: string;
}
