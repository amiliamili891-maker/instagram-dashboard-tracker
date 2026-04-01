-- Add chat_type and chatter_name columns to sessions table
-- chat_type: 'ai' or 'manual' (from Ghstly Partner API)
-- chatter_name: name of the human chatter (null for AI sessions)

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS chat_type text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS chatter_name text;

-- Index for filtering by chat_type (common query for AI vs human analysis)
CREATE INDEX IF NOT EXISTS idx_sessions_chat_type ON sessions (chat_type);

-- Backfill comment: existing rows will have NULL chat_type until next sync
COMMENT ON COLUMN sessions.chat_type IS 'ai or manual — from Ghstly Partner API chat_type field';
COMMENT ON COLUMN sessions.chatter_name IS 'Human chatter name when chat_type=manual, null for AI';
