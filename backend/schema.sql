-- Database schema for Live Chat Support System

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'super_admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    capacity INTEGER NOT NULL DEFAULT 5 CHECK (capacity BETWEEN 1 AND 100),
    session_version INTEGER NOT NULL DEFAULT 0,
    setup_token_hash TEXT,
    setup_expires_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'offline', -- online, offline, away
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Visitors
CREATE TABLE IF NOT EXISTS visitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visitor_id VARCHAR(255) UNIQUE NOT NULL, -- client-generated ID
    ip_address VARCHAR(45),
    user_agent TEXT,
    location VARCHAR(255), -- approximate location
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visitor_id UUID REFERENCES visitors(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'open', -- open, resolved, closed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) NOT NULL, -- 'agent', 'visitor', 'system'
    sender_id VARCHAR(255), -- agent id or visitor id
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text', -- text, image, emoji
    client_message_id UUID, -- sender-scoped retry key; NULL for legacy/system messages
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quick Replies
CREATE TABLE IF NOT EXISTS quick_replies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Knowledge Base / FAQ
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword VARCHAR(255) NOT NULL,
    response TEXT NOT NULL,
    is_exact BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_visitor ON conversations(visitor_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_request
    ON messages (conversation_id, sender_type, sender_id, client_message_id)
    WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_history ON messages (conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (updated_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_normalized_email ON agents (lower(btrim(email)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_setup_token ON agents (setup_token_hash) WHERE setup_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_owner_open ON conversations (agent_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS conversation_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    agent_id UUID NOT NULL REFERENCES agents(id),
    action TEXT NOT NULL CHECK (action IN ('accepted', 'deactivated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assignment_history ON conversation_assignments (conversation_id, created_at, id);

-- Default settings
INSERT INTO settings (key, value) VALUES 
('welcome_message', 'Hello! How can we help you today?'),
('announcement', ''),
('announcement_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Sample data (optional, for demo)
-- INSERT INTO agents (name, email, password_hash) VALUES ('Admin', 'admin@example.com', '$2b$10$...'); -- hash for 'password'
