import type { Server } from 'socket.io';
import type { Identity, Message } from './types';

export type PublicError = { code: string; message: string };
export type Ack<T> = { ok: true; data: T } | { ok: false; error: PublicError };
// All incoming values remain unknown until runtime validation in the handler.
export type ClientEvent = 'agent_status' | 'visitor_presence' | 'visitor_join' | 'message_history' | 'send_message' | 'typing';
export type ClientEvents = Record<ClientEvent, (payload: unknown, acknowledge?: (result: Ack<unknown>) => void) => void>;
export interface ServerEvents {
  conversation_update: (data: Record<string, never>) => void;
  presence_changed: () => void;
  session_expired: () => void;
  support_availability: (data: { online: boolean }) => void;
  service_state: (data: { redis: boolean }) => void;
  agent_status_current: (status: 'online' | 'offline') => void;
  request_error: (error: PublicError) => void;
  conversation_ready: (data: { conversationId: string; visitorToken: string }) => void;
  new_message: (message: Message) => void;
  conversation_resolved: (data: { id: string }) => void;
  typing: (data: { conversationId: string; isTyping: boolean; isAgent: boolean }) => void;
}
export type ChatServer = Server<ClientEvents, ServerEvents, Record<string, never>, { identity?: Identity }>;
export type PublishedEvent = 'new_message' | 'conversation_resolved' | 'typing';
