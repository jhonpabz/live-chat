BEGIN;

-- Nullable for historical messages and automatic system replies.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_request
  ON messages (conversation_id, sender_type, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_history ON messages (conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (updated_at, id);

COMMIT;
