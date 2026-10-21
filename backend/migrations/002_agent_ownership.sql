BEGIN;

-- Abort instead of silently merging accounts that normalize to the same email.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM agents GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate normalized agent emails. Resolve duplicates before migration.';
  END IF;
END $$;
UPDATE agents SET email = lower(btrim(email)) WHERE email <> lower(btrim(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_normalized_email ON agents (lower(btrim(email)));
ALTER TABLE agents ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'super_admin'));
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 5 CHECK (capacity BETWEEN 1 AND 100);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS setup_token_hash TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS setup_expires_at TIMESTAMPTZ;
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
COMMIT;
